import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { Logger } from '../logger.ts';
import { AppError } from '../errors.ts';
import { User } from '../models/user.model.ts';
import { Membership } from '../models/membership.model.ts';
import { createChallenge, normalisePhone, verifyChallenge } from './otp.ts';
import {
  hashRefreshToken,
  issueRefreshToken,
  revokeAllForUser,
  rotateRefreshToken,
  signAccessToken,
} from './tokens.ts';
import { RefreshToken } from '../models/refreshToken.model.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { parse } from '../http/validate.ts';

const requestSchema = z.object({ phone: z.string().min(6).max(20) });
const verifySchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'The code is six digits'),
  deviceId: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80).optional(),
});
const refreshSchema = z.object({
  refreshToken: z.string().min(1),
  deviceId: z.string().min(8).max(128),
});

export function authRoutes(config: Config, logger: Logger): Router {
  const router = Router();

  // Blunt but effective: an SMS costs money and a phone number is a person.
  const otpLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res
        .status(429)
        .json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } });
    },
  });

  router.post('/otp/request', otpLimiter, async (req, res) => {
    const { phone } = parse(requestSchema, req.body);
    const normalised = normalisePhone(phone);
    const exposeCode = config.SMS_PROVIDER === 'log';

    const challenge = await createChallenge(normalised, config.OTP_TTL_MINUTES, exposeCode);

    if (exposeCode) {
      // Development only. The redaction list keeps this out of production logs regardless.
      logger.info({ challengeId: challenge.challengeId }, 'OTP issued (SMS delivery is stubbed)');
    }

    res.status(201).json({
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt.toISOString(),
      ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
    });
  });

  router.post('/otp/verify', otpLimiter, async (req, res) => {
    const { challengeId, code, deviceId, name } = parse(verifySchema, req.body);
    const { phone } = await verifyChallenge(challengeId, code, config.OTP_MAX_ATTEMPTS);

    // First sign-in creates the account. There is no separate registration step.
    let user = await User.findOne({ phone }).exec();
    if (!user) {
      user = await User.create({ phone, ...(name ? { name } : {}) });
    } else if (name && !user.name) {
      user.name = name;
      await user.save();
    }
    user.lastSeenAt = new Date();
    await user.save();

    const [accessToken, refresh] = await Promise.all([
      signAccessToken(user._id, config.JWT_SECRET, config.ACCESS_TOKEN_TTL_MINUTES),
      issueRefreshToken(user._id, deviceId, config.REFRESH_TOKEN_TTL_DAYS),
    ]);

    res.status(200).json({
      accessToken,
      refreshToken: refresh.token,
      expiresIn: config.ACCESS_TOKEN_TTL_MINUTES * 60,
      user: { id: user._id, name: user.name ?? null, locale: user.locale },
    });
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
      isPlatformAdmin: user.isPlatformAdmin === true,
      farms: memberships.map((m) => ({ farmId: m.farmId, role: m.role })),
    });
  });

  return router;
}
