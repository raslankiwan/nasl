import { pino } from 'pino';

/**
 * Phone numbers identify a person and are the one piece of personal data this service handles in
 * bulk. They never reach the logs, in any environment.
 */
const REDACTED_PATHS = [
  'req.body.phone',
  'req.body.code',
  'req.body.refreshToken',
  'req.headers.authorization',
  'phone',
  'code',
  'refreshToken',
  'accessToken',
];

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino/file', options: { destination: 1 } } } : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
