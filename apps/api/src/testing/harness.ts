import { User } from '../models/user.model.ts';
import { hashPassword } from '../auth/passwords.ts';
import type { VerificationMailer, VerificationMessage } from '../auth/verificationEmail.ts';
import type { InvitationMailer } from '../auth/invitationEmail.ts';
import type { Express } from 'express';
import { createApp } from '../app.ts';
import { loadConfig, type Config } from '../config.ts';
import { createLogger } from '../logger.ts';

export const TEST_CONFIG_ENV = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://unused-in-tests',
  JWT_SECRET: 'test-secret-that-is-definitely-long-enough-32',
  LOG_LEVEL: 'silent',
} as const;

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ ...TEST_CONFIG_ENV } as NodeJS.ProcessEnv), ...overrides };
}

export const verificationMessages: VerificationMessage[] = [];
export const testVerificationMailer: VerificationMailer = async (message) => {
  verificationMessages.push(message);
};

export function testApp(
  overrides: Partial<Config> = {},
  invitationMailer?: InvitationMailer,
  verificationMailer: VerificationMailer = testVerificationMailer,
): Express {
  const config = testConfig(overrides);
  return createApp({
    config,
    logger: createLogger('silent', false),
    invitationMailer,
    verificationMailer,
  });
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

/**
 * Drive the app over a real socket. Slightly slower than injecting requests, but it exercises the
 * JSON parsing, error middleware and status codes a client will actually meet.
 */
export async function withServer<T>(app: Express, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind a test port');
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export function api(baseUrl: string, token?: string) {
  const request = async <T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    as: (nextToken: string) => api(baseUrl, nextToken),
  };
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

export interface TestSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string | null; locale: string };
}

export const TEST_DEVICE = 'device-0123456789';

export const TEST_PASSWORD = 'test-only-passphrase-123';
let fixturePasswordHash: Promise<string> | undefined;
export function fixtureUsername(identity: string): string {
  return `user${identity.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
}

/** Seed an approved test identity, then exercise the real password login endpoint. */
export async function signIn(
  baseUrl: string,
  identity: string,
  name?: string,
): Promise<TestSession> {
  const username = fixtureUsername(identity);
  if (!(await User.exists({ username }))) {
    fixturePasswordHash ??= hashPassword(TEST_PASSWORD);
    await User.create({
      username,
      email: `${username}@example.test`,
      name: name ?? username,
      passwordHash: await fixturePasswordHash,
      status: 'approved',
    });
  }
  const session = await api(baseUrl).post<TestSession>('/v1/auth/login', {
    identifier: username,
    password: TEST_PASSWORD,
    deviceId: TEST_DEVICE,
  });
  if (session.status !== 200) {
    throw new Error(`Login failed: ${session.status} ${JSON.stringify(session.body)}`);
  }
  return session.body;
}

/** Sign a new user in and give them a farm they own. */
export async function signInWithFarm(
  baseUrl: string,
  phone: string,
  farmName = 'مراح الاختبار',
): Promise<{ session: TestSession; farmId: string }> {
  const session = await signIn(baseUrl, phone);
  const farm = await api(baseUrl, session.accessToken).post<{ id: string }>('/v1/farms', {
    name: farmName,
  });
  if (farm.status !== 201) {
    throw new Error(`Farm creation failed: ${farm.status} ${JSON.stringify(farm.body)}`);
  }
  return { session, farmId: farm.body.id };
}

/** Promote a signed-in user to platform staff. */
export async function makePlatformAdmin(userId: string): Promise<void> {
  const { User } = await import('../models/user.model.ts');
  await User.updateOne({ _id: userId }, { $set: { isPlatformAdmin: true } }).exec();
}

export async function verifyTestEmail(baseUrl: string, email: string) {
  const message = verificationMessages.findLast((entry) => entry.email === email.toLowerCase());
  if (!message) throw new Error('No verification email in test mailbox');
  const result = await api(baseUrl).post('/v1/auth/email/verify', {
    verificationId: message.id,
    code: message.code,
  });
  if (result.status !== 200) throw new Error('Test email verification failed');
}
