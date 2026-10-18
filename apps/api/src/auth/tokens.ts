import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../errors.ts';
import { RefreshToken } from '../models/refreshToken.model.ts';
import { User } from '../models/user.model.ts';
import { verifiedEmailFilter } from './accountAccess.ts';
import type { Config } from '../config.ts';
import { assertAccountAccess } from './accountAccess.ts';

export interface AccessTokenClaims {
  sub: string;
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const ISSUER = 'nasl';
const AUDIENCE = 'nasl-clients';

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  userId: string,
  secret: string,
  ttlMinutes: number,
): Promise<string> {
  return new SignJWT({ jti: randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(secretKey(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.sub) throw new Error('missing subject');
    return { sub: payload.sub, jti: String(payload.jti ?? '') };
  } catch {
    throw AppError.unauthorized('Your session has expired. Sign in again.');
  }
}

/** Refresh tokens are 256 bits of randomness, so a fast hash is sufficient. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function mintRefreshTokenValue(): string {
  return randomBytes(32).toString('base64url');
}

export async function issueRefreshToken(
  userId: string,
  deviceId: string,
  ttlDays: number,
  familyId: string = randomUUID(),
  sessionExpiresAt = new Date(Date.now() + ttlDays * 86_400_000),
): Promise<{ token: string; familyId: string; id: string }> {
  const token = mintRefreshTokenValue();
  const created = await RefreshToken.create({
    userId,
    deviceId,
    tokenHash: hashRefreshToken(token),
    familyId,
    expiresAt: sessionExpiresAt,
    sessionExpiresAt,
  });
  return { token, familyId, id: created._id };
}

/**
 * Exchange a refresh token for a new pair.
 *
 * Presenting an already-revoked token means the token was copied off the device, so the entire
 * family is revoked rather than just the one token.
 */
export async function rotateRefreshToken(
  presented: string,
  deviceId: string,
  ttlDays: number,
): Promise<{ userId: string; token: string; familyId: string }> {
  const existing = await RefreshToken.findOne({ tokenHash: hashRefreshToken(presented) }).exec();

  if (!existing) throw AppError.unauthorized('Sign in again.');

  if (existing.revokedAt) {
    await RefreshToken.updateMany(
      { familyId: existing.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    ).exec();
    throw AppError.unauthorized('This session is no longer valid. Sign in again.');
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw AppError.unauthorized('Your session has expired. Sign in again.');
  }

  if (existing.deviceId !== deviceId) {
    throw AppError.unauthorized('This session belongs to a different device.');
  }

  if (!(await User.exists({ _id: existing.userId, status: 'approved', ...verifiedEmailFilter }))) {
    await revokeAllForUser(existing.userId);
    throw AppError.unauthorized('An approved account is required.');
  }

  // Existing sessions upgrade on their next valid rotation; new sessions have a fixed deadline.
  const next = await issueRefreshToken(
    existing.userId,
    deviceId,
    ttlDays,
    existing.familyId,
    existing.sessionExpiresAt,
  );

  existing.revokedAt = new Date();
  existing.replacedByTokenId = next.id;
  await existing.save();

  return { userId: existing.userId, token: next.token, familyId: existing.familyId };
}

export async function revokeFamily(familyId: string): Promise<void> {
  await RefreshToken.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  ).exec();
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  ).exec();
}

export async function createSession(userId: string, deviceId: string, config: Config) {
  const user = await User.findById(userId);
  if (!user) throw AppError.unauthorized();
  assertAccountAccess(user);
  user.lastSeenAt = new Date();
  await user.save();
  const [accessToken, refresh] = await Promise.all([
    signAccessToken(userId, config.JWT_SECRET, config.ACCESS_TOKEN_TTL_MINUTES),
    issueRefreshToken(userId, deviceId, config.REFRESH_TOKEN_TTL_DAYS),
  ]);
  return {
    accessToken,
    refreshToken: refresh.token,
    expiresIn: config.ACCESS_TOKEN_TTL_MINUTES * 60,
    user: {
      id: user._id,
      name: user.name ?? null,
      email: user.email,
      username: user.username,
      locale: user.locale,
    },
  };
}
