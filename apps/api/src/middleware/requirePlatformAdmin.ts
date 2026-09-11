import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.ts';
import { User } from '../models/user.model.ts';

/**
 * Gate the operator console.
 *
 * Being a platform admin grants access to tenant *metadata* — plans, head counts, sync health —
 * and to the shared reference libraries. It does not grant access to a farm's records; reading
 * those still requires an audited, reason-logged support session.
 */
export function requirePlatformAdmin() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) throw AppError.unauthorized();

      const user = await User.findById(userId).select('isPlatformAdmin').lean().exec();
      if (!user?.isPlatformAdmin) throw AppError.notFound();

      next();
    } catch (err) {
      next(err);
    }
  };
}
