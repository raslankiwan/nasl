import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../errors.ts';
import { User } from '../models/user.model.ts';
import { recordAudit } from '../models/auditLog.model.ts';

interface Review {
  userId: string;
  actorId: string;
  status: 'approved' | 'rejected';
  expectedStatus: 'pending' | 'rejected';
  reason?: string;
}

export async function reviewAccount(input: Review, transactional: boolean) {
  const apply = async (session?: ClientSession) => {
    const user = await User.findById(input.userId)
      .session(session ?? null)
      .lean();
    if (!user) throw AppError.notFound('User not found');
    if (user.isPlatformAdmin || user._id === input.actorId) {
      throw AppError.forbidden('Operator accounts cannot be reviewed here.');
    }
    const reviewedAt = new Date();
    const changed = await User.updateOne(
      { _id: user._id, status: input.expectedStatus, isPlatformAdmin: false },
      { $set: { status: input.status, reviewedAt, reviewedBy: input.actorId } },
      { session },
    );
    if (!changed.modifiedCount)
      throw AppError.conflict('This account was already reviewed. Reload and try again.');
    try {
      await recordAudit(
        {
          actorId: input.actorId,
          action: 'user.approval.change',
          targetType: 'user',
          targetId: user._id,
          reason: input.reason || null,
          before: { status: input.expectedStatus },
          after: { status: input.status },
        },
        session,
      );
    } catch (error) {
      if (!session) {
        await User.updateOne(
          { _id: user._id, reviewedAt },
          {
            $set: {
              status: input.expectedStatus,
              reviewedAt: user.reviewedAt ?? null,
              reviewedBy: user.reviewedBy ?? null,
            },
          },
        );
      }
      throw error;
    }
    return { id: user._id, status: input.status };
  };
  return transactional ? mongoose.connection.transaction(apply) : apply();
}
