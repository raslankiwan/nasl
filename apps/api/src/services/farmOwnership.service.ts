import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../errors.ts';
import { Farm } from '../models/farm.model.ts';
import { Membership } from '../models/membership.model.ts';
import { User } from '../models/user.model.ts';
import { recordAudit } from '../models/auditLog.model.ts';

// The local API runs against standalone MongoDB. Serialize transfers per farm and compensate
// failed writes, as farm provisioning does; an optimistic owner check rejects stale forms.
const changing = new Set<string>();

interface OwnerChange {
  farmId: string;
  expectedOwnerUserId: string;
  ownerUserId: string;
  actorId: string;
  reason?: string;
}

export async function changeFarmOwner(input: OwnerChange, transactional = false) {
  if (transactional) {
    return mongoose.connection.transaction((session) => transfer(input, session));
  }
  const { farmId } = input;
  if (changing.has(farmId))
    throw AppError.conflict('Ownership is being changed. Reload and retry.');
  changing.add(farmId);
  try {
    return await transfer(input);
  } finally {
    changing.delete(farmId);
  }
}

async function transfer(input: OwnerChange, session?: ClientSession) {
  const { farmId, expectedOwnerUserId, actorId, reason } = input;
  const farm = await Farm.findById(farmId)
    .session(session ?? null)
    .lean()
    .exec();
  if (!farm) throw AppError.notFound('Farm not found');
  if (farm.ownerUserId !== expectedOwnerUserId) {
    throw AppError.conflict('The farm owner has changed. Reload before trying again.');
  }
  const owner = await User.findOne({ _id: input.ownerUserId, status: 'approved' })
    .session(session ?? null)
    .lean()
    .exec();
  if (!owner) throw AppError.notFound('Approved user not found');
  const result = {
    id: farmId,
    owner: {
      id: owner._id,
      name: owner.name ?? null,
      email: owner.email,
      username: owner.username,
    },
  };
  if (owner._id === farm.ownerUserId) return result;

  const affectedUsers = [farm.ownerUserId, owner._id];
  const before = session
    ? []
    : await Membership.find({ farmId, userId: { $in: affectedUsers } })
        .lean()
        .exec();
  const changed = await Farm.updateOne(
    { _id: farmId, ownerUserId: expectedOwnerUserId },
    { $set: { ownerUserId: owner._id } },
    { session },
  );
  if (!changed.modifiedCount)
    throw AppError.conflict('The farm owner has changed. Reload and retry.');
  try {
    await Membership.updateOne(
      { farmId, userId: owner._id },
      { $set: { role: 'owner', status: 'active', expiresAt: null, invitedBy: actorId } },
      { upsert: true, runValidators: true, session },
    );
    await Membership.updateOne(
      { farmId, userId: farm.ownerUserId },
      { $set: { status: 'revoked' } },
      { session },
    );
    await recordAudit(
      {
        actorId,
        action: 'farm.owner.change',
        targetType: 'farm',
        targetId: farmId,
        reason: reason || null,
        before: { ownerUserId: farm.ownerUserId },
        after: { ownerUserId: owner._id, previousOwnerStatus: 'revoked' },
      },
      session,
    );
  } catch (error) {
    if (session) throw error;
    // Restore only these two memberships, leaving every other member and farm untouched.
    for (const userId of affectedUsers) {
      const membership = before.find((m) => m.userId === userId);
      if (membership) {
        await Membership.replaceOne({ farmId, userId }, membership, { upsert: true });
      } else {
        await Membership.deleteOne({ farmId, userId });
      }
    }
    await Farm.updateOne(
      { _id: farmId, ownerUserId: owner._id },
      { $set: { ownerUserId: farm.ownerUserId } },
    );
    throw error;
  }
  return result;
}
