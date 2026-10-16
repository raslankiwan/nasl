import { pino } from 'pino';

/** Credentials and personal identifiers must never reach application logs. */
const REDACTED_PATHS = [
  'req.body.email',
  'req.body.username',
  'req.body.identifier',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.refreshToken',
  'req.headers.authorization',
  'email',
  'username',
  'identifier',
  'password',
  'passwordHash',
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
