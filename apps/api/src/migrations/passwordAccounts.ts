import { User } from '../models/user.model.ts';

/** Preserve legacy users and farm links, but require a new approved password identity to log in. */
export async function preparePasswordAccounts(): Promise<void> {
  const indexes = await User.collection.indexes().catch((error: { code?: number }) => {
    if (error.code === 26) return [];
    throw error;
  });
  for (const index of indexes) {
    if (index.name && Object.keys(index.key).length === 1 && index.key.phone === 1) {
      await User.collection.dropIndex(index.name);
    }
  }
  await User.updateMany({ status: { $exists: false } }, { $set: { status: 'pending' } });
}
