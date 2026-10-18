import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { parse } from '../http/validate.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { Passkey, PasskeyChallenge } from '../models/passkey.model.ts';
import { User } from '../models/user.model.ts';
import { verifyPassword } from './passwords.ts';
import { mongoRateLimitStore } from './rateLimitStore.ts';
import { createSession } from './tokens.ts';
import { assertAccountAccess } from './accountAccess.ts';

const device = z.object({ deviceId: z.string().min(8).max(128) }).strict();
const finish = device
  .extend({
    challengeId: z.string().uuid(),
    response: z.object({ id: z.string().min(1).max(2048) }).passthrough(),
  })
  .strict();
const invalid = () =>
  new AppError('passkey_invalid', 'Passkey verification failed. Try again or use your password.');

/** Each app origin has its own RP ID; never share credentials across unrelated Vercel tenants. */
function relyingParty(req: Request, config: Config) {
  const origin = req.get('origin');
  const allowed = config.CORS_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (config.NODE_ENV !== 'production')
    allowed.push('http://localhost:8081', 'http://localhost:5174');
  if (!origin || !allowed.includes(origin)) throw AppError.forbidden('Untrusted passkey origin.');
  const url = new URL(origin);
  if (config.NODE_ENV === 'production' && url.protocol !== 'https:') throw invalid();
  return { origin, rpId: url.hostname };
}

export function passkeyRoutes(config: Config) {
  const router = Router();
  const authenticated = requireAuth(config.JWT_SECRET);
  router.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 60,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      store: mongoRateLimitStore('passkey-ip'),
      handler: (_req, res) => {
        res.status(429).json({ error: { code: 'rate_limited', message: 'Try again later.' } });
      },
    }),
  );
  router.get('/', authenticated, async (req, res) => {
    const { rpId } = relyingParty(req, config);
    const keys = await Passkey.find({ userId: req.auth!.userId, rpId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      passkeys: keys.map((key) => ({
        id: key._id,
        name: key.name,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt ?? null,
      })),
    });
  });
  router.post('/remove', authenticated, async (req, res) => {
    const { id } = parse(z.object({ id: z.string().uuid() }).strict(), req.body);
    const { rpId } = relyingParty(req, config);
    await Passkey.deleteOne({ _id: id, userId: req.auth!.userId, rpId });
    res.status(204).end();
  });
  router.post('/register/options', authenticated, async (req, res) => {
    const { password, deviceId, name } = parse(
      device
        .extend({ password: z.string().min(1).max(128), name: z.string().trim().min(1).max(60) })
        .strict(),
      req.body,
    );
    const { origin, rpId } = relyingParty(req, config);
    const user = await User.findById(req.auth!.userId).select('+passwordHash');
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      throw AppError.unauthorized();
    assertAccountAccess(user);
    const existing = await Passkey.find({ userId: user._id, rpId }).lean();
    if (existing.length >= 10)
      throw AppError.conflict('Remove an unused passkey before adding another.');
    const options = await generateRegistrationOptions({
      rpName: 'Nasl',
      rpID: rpId,
      userID: new TextEncoder().encode(user._id),
      userName: user.username,
      userDisplayName: user.name ?? user.username,
      attestationType: 'none',
      supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: existing.map((key) => ({
        id: key.credentialId,
        transports: key.transports,
      })),
    });
    const challenge = await PasskeyChallenge.create({
      challenge: options.challenge,
      purpose: 'register',
      userId: user._id,
      deviceId,
      origin,
      rpId,
      name,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    res.json({ challengeId: challenge._id, options });
  });
  router.post('/register/verify', authenticated, async (req, res) => {
    const input = parse(finish, req.body);
    const { origin, rpId } = relyingParty(req, config);
    const challenge = await PasskeyChallenge.findOneAndDelete({
      _id: input.challengeId,
      purpose: 'register',
      userId: req.auth!.userId,
      deviceId: input.deviceId,
      origin,
      rpId,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!challenge) throw invalid();
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: input.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch {
      throw invalid();
    }
    if (!result.verified) throw invalid();
    const { credential } = result.registrationInfo;
    try {
      await Passkey.create({
        userId: req.auth!.userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        name: challenge.name,
        rpId,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw AppError.conflict('This passkey is already registered.');
      throw error;
    }
    res.status(201).json({ registered: true });
  });
  router.post('/login/options', async (req, res) => {
    const { deviceId } = parse(device, req.body);
    const { origin, rpId } = relyingParty(req, config);
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
    });
    const challenge = await PasskeyChallenge.create({
      challenge: options.challenge,
      purpose: 'login',
      deviceId,
      origin,
      rpId,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    res.json({ challengeId: challenge._id, options });
  });
  router.post('/login/verify', async (req, res) => {
    const input = parse(finish, req.body);
    const { origin, rpId } = relyingParty(req, config);
    const challenge = await PasskeyChallenge.findOneAndDelete({
      _id: input.challengeId,
      purpose: 'login',
      deviceId: input.deviceId,
      origin,
      rpId,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!challenge) throw invalid();
    const key = await Passkey.findOne({ credentialId: input.response.id, rpId });
    if (!key) throw invalid();
    const response = input.response as unknown as AuthenticationResponseJSON;
    if (
      response.response?.userHandle &&
      response.response.userHandle !== Buffer.from(key.userId).toString('base64url')
    )
      throw invalid();
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: key.credentialId,
          publicKey: new Uint8Array(key.publicKey),
          counter: key.counter,
        },
      });
    } catch {
      throw invalid();
    }
    if (!result.verified) throw invalid();
    // Optimistic counter check also prevents concurrent replays on counting authenticators.
    const updated = await Passkey.updateOne(
      { _id: key._id, counter: key.counter },
      { $set: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() } },
    );
    if (!updated.matchedCount) throw invalid();
    res.json(await createSession(key.userId, input.deviceId, config));
  });
  return router;
}
