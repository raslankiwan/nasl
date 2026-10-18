import { Router } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { User } from '../models/user.model.ts';
import { Membership } from '../models/membership.model.ts';
import { PASSWORD_MAX_LENGTH } from '@nasl/shared';
import { registrationSchema } from './credentials.ts';
import { invitationAuthRoutes } from './invitation.routes.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import {
  hashRefreshToken,
  createSession,
  revokeAllForUser,
  rotateRefreshToken,
  signAccessToken,
} from './tokens.ts';
import { RefreshToken } from '../models/refreshToken.model.ts';
import { mongoRateLimitStore } from './rateLimitStore.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { parse } from '../http/validate.ts';
import { verificationMailer, type VerificationMailer } from './verificationEmail.ts';
import {
  emailVerificationRoutes,
  requireVerificationMailer,
  sendVerification,
} from './emailVerification.ts';
import { passkeyRoutes } from './passkeys.ts';

const loginSchema = z
  .object({
    identifier: z.string().trim().toLowerCase().min(1).max(254),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    deviceId: z.string().min(8).max(128),
  })
  .strict();
const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  deviceId: z.string().min(8).max(128),
});

export function authRoutes(config: Config, injectedMailer?: VerificationMailer): Router {
  const sendEmail = injectedMailer ?? verificationMailer(config);
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use('/admin-invitations', invitationAuthRoutes(config));
  router.use('/email', emailVerificationRoutes(config, sendEmail));
  router.use('/passkeys', passkeyRoutes(config));

  const limitOptions: Partial<Options> = {
    windowMs: 15 * 60_000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res
        .status(429)
        .json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } });
    },
  };

  const registerLimiter = rateLimit({
    ...limitOptions,
    limit: 10,
    store: mongoRateLimitStore('register-ip'),
  });
  const loginIpLimiter = rateLimit({
    ...limitOptions,
    limit: 60,
    skipSuccessfulRequests: true,
    store: mongoRateLimitStore('login-ip'),
  });
  const loginAccountLimiter = rateLimit({
    ...limitOptions,
    limit: 10,
    skipSuccessfulRequests: true,
    store: mongoRateLimitStore('login-account'),
    keyGenerator: (req) => parse(loginSchema, req.body).identifier,
  });

  router.post('/register', registerLimiter, async (req, res) => {
    const { password, ...profile } = parse(registrationSchema, req.body);
    const conflict = () =>
      new AppError('registration_conflict', 'That email or username is already in use.');
    if (await User.exists({ $or: [{ email: profile.email }, { username: profile.username }] })) {
      throw conflict();
    }
    requireVerificationMailer(sendEmail);
    try {
      const user = await User.create({
        ...profile,
        passwordHash: await hashPassword(password),
        status: 'pending',
        emailVerificationRequired: true,
        isPlatformAdmin: false,
      });
      // Registration never issues credentials, even for the first account.
      let verificationId: string | undefined;
      try {
        verificationId = await sendVerification(user, config, sendEmail);
      } catch {
        /* The pending account can retry delivery without losing its registration. */
      }
      res.status(201).json({
        id: user._id,
        status: 'pending',
        verificationId,
        verificationSent: Boolean(verificationId),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw conflict();
      throw error;
    }
  });

  router.post('/login', loginIpLimiter, loginAccountLimiter, async (req, res) => {
    const { identifier, password, deviceId } = parse(loginSchema, req.body);
    const user = await User.findOne(
      identifier.includes('@') ? { email: identifier } : { username: identifier },
    )
      .select('+passwordHash')
      .exec();
    if (!(await verifyPassword(password, user?.passwordHash)) || !user) {
      throw AppError.unauthorized('Incorrect email, username or password.');
    }
    res.status(200).json(await createSession(user._id, deviceId, config));
  });

  router.post('/refresh', async (req, res) => {
    const { refreshToken, deviceId } = parse(refreshSchema, req.body);
    const rotated = await rotateRefreshToken(refreshToken, deviceId, config.REFRESH_TOKEN_TTL_DAYS);
    const accessToken = await signAccessToken(
      rotated.userId,
      config.JWT_SECRET,
      config.ACCESS_TOKEN_TTL_MINUTES,
    );
    res.status(200).json({
      accessToken,
      refreshToken: rotated.token,
      expiresIn: config.ACCESS_TOKEN_TTL_MINUTES * 60,
    });
  });

  router.post('/sign-out', async (req, res) => {
    const { refreshToken } = parse(refreshSchema.pick({ refreshToken: true }), req.body);
    await RefreshToken.updateOne(
      { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      { $set: { revokedAt: new Date() } },
    ).exec();
    res.status(204).end();
  });

  router.post('/sign-out-everywhere', requireAuth(config.JWT_SECRET), async (req, res) => {
    await revokeAllForUser(req.auth!.userId);
    res.status(204).end();
  });

  router.get('/me', requireAuth(config.JWT_SECRET), async (req, res) => {
    const user = await User.findById(req.auth!.userId).lean().exec();
    if (!user) throw AppError.unauthorized();

    const memberships = await Membership.find({ userId: user._id, status: 'active' })
      .select('farmId role')
      .lean()
      .exec();

    res.json({
      id: user._id,
      name: user.name ?? null,
      locale: user.locale,
      email: user.email,
      username: user.username,
      isPlatformAdmin: user.isPlatformAdmin === true,
      farms: memberships.map((m) => ({ farmId: m.farmId, role: m.role })),
    });
  });

  return router;
}
