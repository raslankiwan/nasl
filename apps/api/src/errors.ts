import type { NextFunction, Request, Response } from 'express';
import type { Logger } from './logger.ts';

/** Stable, client-readable error codes. Clients branch on these, never on the message. */
export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'account_pending',
  'account_rejected',
  'registration_conflict',
  'invitation_invalid',
  'invitation_existing_password',
  'push_unavailable',
  'email_not_configured',
  'email_delivery_failed',
  'email_unverified',
  'verification_invalid',
  'passkey_invalid',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  account_pending: 403,
  account_rejected: 403,
  registration_conflict: 409,
  invitation_invalid: 400,
  invitation_existing_password: 400,
  push_unavailable: 503,
  email_not_configured: 503,
  email_delivery_failed: 503,
  email_unverified: 403,
  verification_invalid: 400,
  passkey_invalid: 400,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError('bad_request', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError('unauthorized', message);
  }
  static forbidden(message = 'You do not have access to this farm') {
    return new AppError('forbidden', message);
  }
  static notFound(message = 'Not found') {
    return new AppError('not_found', message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError('conflict', message, details);
  }
}

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function errorHandler(logger: Logger) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof AppError) {
      const body: ErrorEnvelope = { error: { code: err.code, message: err.message } };
      if (err.details !== undefined) body.error.details = err.details;
      res.status(err.status).json(body);
      return;
    }

    // Anything unrecognised is a bug. Log it fully; tell the client nothing.
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
}
