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
  'sign_in_unavailable',
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
  sign_in_unavailable: 503,
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
