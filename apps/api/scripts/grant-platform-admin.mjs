/** Revoke staff access. New administrators must accept an email invitation.
 * node --env-file-if-exists=.env scripts/grant-platform-admin.mjs <email-or-username> [--revoke]
 * Verify the intended operator owns the registration before using this database-only tool.
 */
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

const [, , suppliedIdentifier, ...flags] = process.argv;
const identifier = suppliedIdentifier?.trim().toLowerCase();
const revoke = flags.includes('--revoke');
if (!identifier || !revoke || flags.some((flag) => flag !== '--revoke')) {
  console.error(
    'Only revocation is supported: grant-platform-admin.mjs <email-or-username> --revoke. Use email invitations for new administrators, or seed-first-admin.ts for the first account.',
  );
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI must be loaded securely before running this command.');
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB_NAME ?? 'nasl',
    maxPoolSize: 2,
  });
  const users = mongoose.connection.collection('users');
  const filter = identifier.includes('@') ? { email: identifier } : { username: identifier };
  const apply = async (session) => {
    const user = await users.findOne(filter, { session });
    if (!user || (!revoke && !user.passwordHash)) {
      throw new Error('No password registration found. The intended operator must register first.');
    }
    const now = new Date();
    const before = {
      isPlatformAdmin: user.isPlatformAdmin === true,
      status: user.status ?? 'pending',
    };
    const after = { isPlatformAdmin: !revoke, status: revoke ? before.status : 'approved' };
    await users.updateOne({ _id: user._id }, { $set: { ...after, updatedAt: now } }, { session });
    try {
      await mongoose.connection.collection('auditlogs').insertOne(
        {
          _id: randomUUID(),
          actorId: 'bootstrap-cli',
          action: 'user.platformAdmin.change',
          targetType: 'user',
          targetId: user._id,
          before,
          after,
          reason: revoke
            ? 'Operator access revoked through database CLI'
            : 'Operator verified and approved through database CLI',
          createdAt: now,
        },
        { session },
      );
    } catch (error) {
      if (!session) await users.updateOne({ _id: user._id, updatedAt: now }, { $set: before });
      throw error;
    }
    return user._id;
  };
  const id =
    process.env.NODE_ENV === 'production'
      ? await mongoose.connection.transaction(apply)
      : await apply();
  console.log(
    `${revoke ? 'Revoked' : 'Approved and granted'} platform admin for ${identifier} (${id})`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operator update failed');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
