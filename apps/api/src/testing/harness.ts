import type { Express } from 'express';
import { createApp } from '../app.ts';
import { loadConfig, type Config } from '../config.ts';
import { createLogger } from '../logger.ts';

export const TEST_CONFIG_ENV = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://unused-in-tests',
  JWT_SECRET: 'test-secret-that-is-definitely-long-enough-32',
  SMS_PROVIDER: 'log',
  LOG_LEVEL: 'silent',
} as const;

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({ ...TEST_CONFIG_ENV } as NodeJS.ProcessEnv), ...overrides };
}

export function testApp(overrides: Partial<Config> = {}): Express {
  const config = testConfig(overrides);
  return createApp({ config, logger: createLogger('silent', false) });
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

/** Request a code and redeem it, returning the session a client would hold. */
export async function signIn(baseUrl: string, phone: string, name?: string): Promise<TestSession> {
  const client = api(baseUrl);
  const challenge = await client.post<{ challengeId: string; devCode: string }>(
    '/v1/auth/otp/request',
    { phone },
  );
  if (challenge.status !== 201) {
    throw new Error(`OTP request failed: ${challenge.status} ${JSON.stringify(challenge.body)}`);
  }
  const session = await client.post<TestSession>('/v1/auth/otp/verify', {
    challengeId: challenge.body.challengeId,
    code: challenge.body.devCode,
    deviceId: TEST_DEVICE,
    ...(name ? { name } : {}),
  });
  if (session.status !== 200) {
    throw new Error(`OTP verify failed: ${session.status} ${JSON.stringify(session.body)}`);
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
