import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from '../errors.ts';
import { OtpChallenge } from '../models/otpChallenge.model.ts';

const scryptAsync = promisify(scrypt);
const CODE_LENGTH = 6;

/**
 * A six-digit code has very little entropy, so it is protected by a short expiry and an attempt
 * limit rather than by the cost of hashing. Hashing with scrypt anyway means a database leak does
 * not hand out live codes.
 */
async function hashCode(code: string, salt: string): Promise<string> {
  const derived = (await scryptAsync(code, salt, 32)) as Buffer;
  return derived.toString('hex');
}

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/** E.164 — the only phone format we accept or store. */
export function normalisePhone(input: string): string {
  const trimmed = input.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) {
    throw AppError.badRequest(
      'Enter your phone number in international format, e.g. +966501234567',
    );
  }
  return trimmed;
}

export interface CreatedChallenge {
  challengeId: string;
  expiresAt: Date;
  /** Present only when SMS delivery is stubbed, so development can read it from the response. */
  devCode?: string;
}

export async function createChallenge(
  phone: string,
  ttlMinutes: number,
  exposeCode: boolean,
  deliver?: (code: string) => Promise<void>,
): Promise<CreatedChallenge> {
  // A new request supersedes any outstanding one for this number.
  await OtpChallenge.deleteMany({ phone, consumedAt: null }).exec();

  const code = generateCode();
  const salt = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  const challenge = await OtpChallenge.create({
    phone,
    salt,
    codeHash: await hashCode(code, salt),
    expiresAt,
  });

  try {
    await deliver?.(code);
  } catch (error) {
    await OtpChallenge.deleteOne({ _id: challenge._id });
    throw error;
  }

  return {
    challengeId: challenge._id,
    expiresAt,
    ...(exposeCode ? { devCode: code } : {}),
  };
}

/**
 * Verify a code against a challenge and consume it.
 *
 * Every failure returns the same message. Telling a caller whether the challenge existed, expired,
 * or simply had the wrong code turns this endpoint into a phone-number oracle.
 */
export async function verifyChallenge(
  challengeId: string,
  code: string,
  maxAttempts: number,
): Promise<{ phone: string }> {
  const invalid = () => AppError.badRequest('That code is not right. Check it and try again.');

  // Reserve an attempt atomically: parallel requests must not bypass the attempt limit.
  const challenge = await OtpChallenge.findOneAndUpdate(
    {
      _id: challengeId,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: maxAttempts },
    },
    { $inc: { attempts: 1 } },
    { new: true },
  ).lean();
  if (!challenge) throw invalid();

  const candidate = Buffer.from(await hashCode(code, challenge.salt), 'hex');
  const expected = Buffer.from(challenge.codeHash, 'hex');
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    throw invalid();
  }

  const consumed = await OtpChallenge.updateOne(
    {
      _id: challengeId,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { consumedAt: new Date() } },
  );
  if (!consumed.modifiedCount) throw invalid();
  return { phone: challenge.phone };
}
