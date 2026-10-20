import { randomBytes, randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { parse } from '../http/validate.ts';
import { recordAudit } from '../models/auditLog.model.ts';
import { ImpersonationSession } from '../models/impersonationSession.model.ts';
import { User } from '../models/user.model.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { verifiedEmailFilter } from './accountAccess.ts';
import { hashRefreshToken, signAccessToken } from './tokens.ts';
import { mongoRateLimitStore } from './rateLimitStore.ts';

export async function startImpersonation(
  adminId: string,
  userId: string,
  reason: string,
  config: Config,
) {
  if (!config.USER_APP_URL) throw AppError.badRequest('The user app URL is not configured.');
  const target = await User.exists({
    _id: userId,
    status: 'approved',
    isPlatformAdmin: { $ne: true },
    ...verifiedEmailFilter,
  });
  if (!target || userId === adminId) throw AppError.badRequest('Choose an approved farm user.');
  const code = randomBytes(32).toString('base64url');
  const session = await ImpersonationSession.create({
    adminId,
    userId,
    reason,
    codeHash: hashRefreshToken(code),
    codeExpiresAt: new Date(Date.now() + 60_000),
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  try {
    await recordAudit({
      actorId: adminId,
      action: 'impersonation.start',
      targetType: 'user',
      targetId: userId,
      reason,
      after: { sessionId: session._id, expiresAt: session.expiresAt },
    });
  } catch (error) {
    await ImpersonationSession.deleteOne({ _id: session._id });
    throw error;
  }
  return { url: `${config.USER_APP_URL}/#impersonation=${code}`, expiresAt: session.expiresAt };
}

export function impersonationRoutes(config: Config) {
  const router = Router();
  router.post(
    '/exchange',
    rateLimit({
      windowMs: 60_000,
      limit: 20,
      store: mongoRateLimitStore('impersonation-exchange'),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
    async (req, res) => {
      if (!config.USER_APP_URL || req.headers.origin !== config.USER_APP_URL)
        throw AppError.forbidden();
      const { code } = parse(
        z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
        req.body,
      );
      const session = await ImpersonationSession.findOneAndUpdate(
        {
          codeHash: hashRefreshToken(code),
          codeExpiresAt: { $gt: new Date() },
          redeemedAt: null,
          revokedAt: null,
        },
        { $set: { redeemedAt: new Date() } },
        { new: true },
      ).lean();
      if (!session) throw AppError.unauthorized('This support link expired or was already used.');
      const [admin, user] = await Promise.all([
        User.exists({
          _id: session.adminId,
          isPlatformAdmin: true,
          status: 'approved',
          ...verifiedEmailFilter,
        }),
        User.exists({
          _id: session.userId,
          isPlatformAdmin: { $ne: true },
          status: 'approved',
          ...verifiedEmailFilter,
        }),
      ]);
      if (!admin || !user) throw AppError.unauthorized();
      await recordAudit({
        actorId: session.adminId,
        action: 'impersonation.enter',
        targetType: 'user',
        targetId: session.userId,
        reason: session.reason,
        after: { sessionId: session._id },
      });
      res.json({
        accessToken: await signAccessToken(session.userId, config.JWT_SECRET, 15, session._id),
        expiresAt: session.expiresAt.toISOString(),
        adminUrl: config.ADMIN_APP_URL ?? null,
      });
    },
  );
  router.post('/end', requireAuth(config.JWT_SECRET), async (req, res) => {
    const support = req.auth?.impersonation;
    if (!support) throw AppError.badRequest('No support session is active.');
    await ImpersonationSession.updateOne(
      { _id: support.sessionId },
      { $set: { revokedAt: new Date() } },
    );
    await recordAudit({
      actorId: support.adminId,
      action: 'impersonation.end',
      targetType: 'user',
      targetId: req.auth!.userId,
      after: { sessionId: support.sessionId },
    });
    res.status(204).end();
  });
  return router;
}

function auditInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(auditInput);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /password|token|secret|credential|authorization/i.test(key)
          ? '[redacted]'
          : auditInput(item),
      ]),
    );
  return value;
}

/** Support grants the target's existing farm permissions, never credential or platform access. */
export async function authorizeImpersonation(
  req: Request,
  res: Response,
  sessionId: string,
  userId: string,
) {
  const session = await ImpersonationSession.findOne({
    _id: sessionId,
    userId,
    expiresAt: { $gt: new Date() },
    redeemedAt: { $ne: null },
    revokedAt: null,
  }).lean();
  if (
    !session ||
    !(await User.exists({
      _id: session.adminId,
      isPlatformAdmin: true,
      status: 'approved',
      ...verifiedEmailFilter,
    }))
  )
    throw AppError.unauthorized('The support session has ended.');
  const path = req.originalUrl.split('?')[0]!;
  const read = ['GET', 'HEAD'].includes(req.method);
  const farm = /^\/v1\/farms(?:\/|$)/.test(path);
  const allowed =
    farm ||
    (read && (path === '/v1/auth/me' || path.startsWith('/v1/reference/'))) ||
    (req.method === 'POST' && path === '/v1/auth/impersonation/end');
  if (!allowed) throw AppError.forbidden('This action is unavailable during impersonation.');
  req.auth = {
    userId,
    impersonation: {
      sessionId,
      adminId: session.adminId,
      expiresAt: session.expiresAt.toISOString(),
    },
  };
  res.set('Cache-Control', 'no-store');
  if (read || !farm || path.endsWith('/sync/pull')) return;
  const requestId = randomUUID();
  const context = { requestId, sessionId, method: req.method, path };
  // Persist intent before dispatch. If auditing is down, no mutation is allowed through.
  await recordAudit({
    actorId: session.adminId,
    action: 'impersonation.change.requested',
    targetType: 'user',
    targetId: userId,
    reason: session.reason,
    after: { ...context, input: auditInput(req.body) },
  });
  let output: unknown;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    output = auditInput(body);
    return json(body);
  };
  const end = res.end.bind(res);
  res.end = ((...args: Parameters<Response['end']>) => {
    void recordAudit({
      actorId: session.adminId,
      action: 'impersonation.change.completed',
      targetType: 'user',
      targetId: userId,
      reason: session.reason,
      after: { ...context, status: res.statusCode, output, succeeded: res.statusCode < 400 },
    })
      .catch((error: unknown) =>
        req.log?.error({ err: error, ...context }, 'Support outcome audit failed'),
      )
      .finally(() => end(...args));
    return res;
  }) as Response['end'];
}
