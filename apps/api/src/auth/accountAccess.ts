import { AppError } from '../errors.ts';
import type { UserDoc } from '../models/user.model.ts';

/** Kept separate from review status: verifying an email never approves an account. */
export const verifiedEmailFilter = {
  $or: [{ emailVerificationRequired: { $ne: true } }, { emailVerifiedAt: { $type: 'date' } }],
};

export function assertAccountAccess(user: UserDoc) {
  if (user.status === 'rejected')
    throw new AppError('account_rejected', 'Your registration was not approved.');
  if (user.emailVerificationRequired && !user.emailVerifiedAt)
    throw new AppError('email_unverified', 'Verify your email before signing in.');
  if (user.status !== 'approved')
    throw new AppError('account_pending', 'Your account is awaiting administrator approval.');
}
