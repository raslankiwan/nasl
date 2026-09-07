import type { NextFunction, Request, Response } from 'express';
import { can, type Permission, type Role } from '@nasl/shared';
import { AppError } from '../errors.ts';
import { Membership } from '../models/membership.model.ts';

/**
 * Authorise the caller against the farm in the route, then attach the membership.
 *
 * Every farm-scoped route mounts this, and every handler downstream reads `req.membership.farmId`
 * rather than the raw path parameter — so the value that reaches the repository is one the server
 * has verified, not one the client supplied.
 */
export function requireFarmAccess(permission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) throw AppError.unauthorized();

      // Express types a route parameter as `string | string[]`; a repeated :farmId is nonsense here.
      const param = req.params.farmId;
      const farmId = typeof param === 'string' ? param : undefined;
      if (!farmId) throw AppError.badRequest('Missing farm');

      const membership = await Membership.findOne({ farmId, userId, status: 'active' })
        .lean()
        .exec();

      // A caller with no membership must not be able to tell an existing farm from a missing one.
      if (!membership) throw AppError.forbidden();

      if (membership.expiresAt && membership.expiresAt.getTime() < Date.now()) {
        throw AppError.forbidden('Your access to this farm has expired.');
      }

      if (!can(membership.role as Role, permission)) {
        throw AppError.forbidden('Your role does not allow this.');
      }

      req.membership = { farmId, role: membership.role };
      next();
    } catch (err) {
      next(err);
    }
  };
}
