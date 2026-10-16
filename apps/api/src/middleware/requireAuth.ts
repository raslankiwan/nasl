import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.ts';
import { verifyAccessToken } from '../auth/tokens.ts';
import { User } from '../models/user.model.ts';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: string };
    membership?: { farmId: string; role: string };
  }
}

export function requireAuth(secret: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
      const claims = await verifyAccessToken(header.slice(7), secret);
      const approved = await User.exists({ _id: claims.sub, status: 'approved' });
      if (!approved) throw AppError.unauthorized('An approved account is required.');
      req.auth = { userId: claims.sub };
      next();
    } catch (err) {
      next(err);
    }
  };
}
