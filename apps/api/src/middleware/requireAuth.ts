import type { NextFunction, Request, Response } from 'express';
import { authorizeImpersonation } from '../auth/impersonation.ts';
import { AppError } from '../errors.ts';
import { verifyAccessToken } from '../auth/tokens.ts';
import { User } from '../models/user.model.ts';
import { verifiedEmailFilter } from '../auth/accountAccess.ts';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      userId: string;
      impersonation?: { sessionId: string; adminId: string; expiresAt: string };
    };
    membership?: { farmId: string; role: string };
  }
}

export function requireAuth(secret: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.auth) {
        next();
        return;
      }
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
      const claims = await verifyAccessToken(header.slice(7), secret);
      const approved = await User.exists({
        _id: claims.sub,
        status: 'approved',
        ...verifiedEmailFilter,
      });
      if (!approved) throw AppError.unauthorized('An approved account is required.');
      req.auth = { userId: claims.sub };
      if (claims.supportSessionId)
        await authorizeImpersonation(req, res, claims.supportSessionId, claims.sub);
      next();
    } catch (err) {
      next(err);
    }
  };
}
