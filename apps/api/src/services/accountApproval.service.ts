import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../errors.ts';
import { User } from '../models/user.model.ts';
import { recordAudit } from '../models/auditLog.model.ts';
import { Farm } from '../models/farm.model.ts';
import { Membership } from '../models/membership.model.ts';

interface Review {
  userId: string;
  actorId: string;
  status: 'approved' | 'rejected';
  expectedStatus: 'pending' | 'rejected';
  reason?: string;
  farm?: { name: string; species: string[] };
}

export async function reviewAccount(input: Review, transactional: boolean) {
  if (input.farm && input.status !== 'approved')
    throw AppError.badRequest('A farm can only be created when approving an account.');
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
    // A fresh id belongs only to this attempt, including when MongoDB retries a transaction.
    const farm = input.farm ? new Farm({ ...input.farm, ownerUserId: user._id }) : null;
    try {
      if (farm) {
        const existingFarm = await Farm.exists({ ownerUserId: user._id }).session(session ?? null);
        const membership = await Membership.exists({
          userId: user._id,
          status: 'active',
          $or: [{ expiresAt: null }, { expiresAt: { $gt: reviewedAt } }],
        }).session(session ?? null);
        if (existingFarm || membership)
          throw AppError.conflict(
            'This user already has a farm. Reload and approve without creating another.',
          );
        await farm.save({ session });
        await Membership.create(
          [
            {
              farmId: farm._id,
              userId: user._id,
              role: 'owner',
              status: 'active',
              invitedBy: input.actorId,
            },
          ],
          { session },
        );
        await User.updateOne({ _id: user._id }, { $set: { defaultFarmId: farm._id } }, { session });
      }
      await recordAudit(
        {
          actorId: input.actorId,
          action: 'user.approval.change',
          targetType: 'user',
          targetId: user._id,
          reason: input.reason || null,
          before: { status: input.expectedStatus },
          after: {
            status: input.status,
            ...(farm
              ? {
                  farm: {
                    id: farm._id,
                    name: farm.name,
                    species: farm.species,
                    ownerUserId: user._id,
                    plan: farm.plan,
                  },
                }
              : {}),
          },
        },
        session,
      );
    } catch (error) {
      if (!session) {
        if (farm) {
          await Membership.deleteMany({ farmId: farm._id });
          await Farm.deleteOne({ _id: farm._id });
          await User.updateOne(
            { _id: user._id, defaultFarmId: farm._id },
            user.defaultFarmId
              ? { $set: { defaultFarmId: user.defaultFarmId } }
              : { $unset: { defaultFarmId: 1 } },
          );
        }
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
    return {
      id: user._id,
      status: input.status,
      ...(farm ? { farm: { id: farm._id, name: farm.name } } : {}),
    };
  };
  return transactional ? mongoose.connection.transaction(apply) : apply();
}
