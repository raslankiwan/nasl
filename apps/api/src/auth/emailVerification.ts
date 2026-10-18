import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { parse } from '../http/validate.ts';
import { EmailVerification } from '../models/emailVerification.model.ts';
import { User, type UserDoc } from '../models/user.model.ts';
import { mongoRateLimitStore } from './rateLimitStore.ts';
import type { VerificationMailer } from './verificationEmail.ts';

function codeHash(challenge: string, code: string, secret: string) {
  return createHmac('sha256', secret).update(`${challenge}:${code}`).digest('hex');
}
export function requireVerificationMailer(
  send?: VerificationMailer,
): asserts send is VerificationMailer {
  if (!send)
    throw new AppError('email_not_configured', 'Email verification is not configured yet.');
}
export async function sendVerification(user: UserDoc, config: Config, send: VerificationMailer) {
  const now = new Date();
  const challengeId = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    await EmailVerification.findOneAndUpdate(
      { userId: user._id, sentAt: { $lte: new Date(now.getTime() - 60_000) } },
      {
        $set: {
          challengeId,
          codeHash: codeHash(challengeId, code, config.JWT_SECRET),
          attempts: 0,
          sentAt: now,
          expiresAt: new Date(now.getTime() + 15 * 60_000),
        },
      },
      { upsert: true, new: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new AppError('rate_limited', 'Wait one minute before requesting another code.');
    throw error;
  }
  try {
    await send({ id: challengeId, email: user.email, code, locale: user.locale });
  } catch (error) {
    await EmailVerification.deleteOne({ userId: user._id, challengeId });
    throw error;
  }
  return challengeId;
}

export function emailVerificationRoutes(config: Config, send?: VerificationMailer) {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      store: mongoRateLimitStore('email-verification-ip'),
      handler: (_req, res) => {
        res.status(429).json({ error: { code: 'rate_limited', message: 'Try again later.' } });
      },
    }),
  );
  router.post('/resend', async (req, res) => {
    const { email } = parse(
      z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict(),
      req.body,
    );
    requireVerificationMailer(send);
    const user = await User.findOne({
      email,
      emailVerificationRequired: true,
      emailVerifiedAt: null,
      status: { $ne: 'rejected' },
    }).lean();
    // Identical public response for unknown, verified and ineligible accounts.
    let verificationId: string = randomUUID();
    if (user) {
      try {
        verificationId = await sendVerification(user, config, send);
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'rate_limited')) throw error;
        verificationId =
          (await EmailVerification.findOne({ userId: user._id }).lean())?.challengeId ??
          verificationId;
      }
    }
    res.json({ verificationId });
  });
  router.post('/verify', async (req, res) => {
    const { verificationId, code } = parse(
      z.object({ verificationId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict(),
      req.body,
    );
    const invalid = () =>
      new AppError('verification_invalid', 'This code is invalid or expired. Request a new code.');
    const candidate = await EmailVerification.findOneAndUpdate(
      { challengeId: verificationId, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
      { $inc: { attempts: 1 } },
      { new: true },
    ).lean();
    if (
      !candidate ||
      !timingSafeEqual(
        Buffer.from(candidate.codeHash, 'hex'),
        Buffer.from(codeHash(verificationId, code, config.JWT_SECRET), 'hex'),
      )
    )
      throw invalid();
    const consumed = await EmailVerification.findOneAndDelete({
      _id: candidate._id,
      challengeId: verificationId,
      expiresAt: { $gt: new Date() },
    });
    if (!consumed) throw invalid();
    const user = await User.findOneAndUpdate(
      { _id: candidate.userId, emailVerificationRequired: true, emailVerifiedAt: null },
      { $set: { emailVerifiedAt: new Date() } },
      { new: true },
    );
    if (!user) throw invalid();
    res.json({ verified: true, status: user.status });
  });
  return router;
}
