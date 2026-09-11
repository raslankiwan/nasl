import type { Request } from 'express';
import type { z } from 'zod';
import { AppError } from '../errors.ts';

/**
 * Parse a request payload, turning schema failures into a field-level 400 the client can render
 * next to the inputs rather than as one opaque message.
 */
export function parse<T extends z.ZodTypeAny>(schema: T, payload: unknown): z.infer<T> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw AppError.badRequest('Check the details and try again.', {
      fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

/** The farm the middleware verified — never the raw path parameter. */
export function farmIdOf(req: Request): string {
  const farmId = req.membership?.farmId;
  if (!farmId) throw AppError.forbidden();
  return farmId;
}

export function userIdOf(req: Request): string {
  const userId = req.auth?.userId;
  if (!userId) throw AppError.unauthorized();
  return userId;
}

/** A single path parameter. Express types these as `string | string[]`. */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw AppError.badRequest(`Missing ${name}`);
  }
  return value;
}
