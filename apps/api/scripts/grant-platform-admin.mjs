/**
 * Grant or revoke platform-staff access.
 *
 * There is no way to become the first platform admin through the API, by design — the console
 * would otherwise be self-service. Bootstrapping happens here, with access to the database.
 *
 *   node --env-file-if-exists=.env scripts/grant-platform-admin.mjs +966501234567
 *   node --env-file-if-exists=.env scripts/grant-platform-admin.mjs +966501234567 --revoke
 */
import mongoose from 'mongoose';

const [, , phone, ...flags] = process.argv;
const revoke = flags.includes('--revoke');

if (!phone?.startsWith('+')) {
  console.error('Usage: grant-platform-admin.mjs <+E164 phone> [--revoke]');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Run with --env-file-if-exists=.env from apps/api.');
  process.exit(1);
}

await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME ?? 'nasl' });
const result = await mongoose.connection
  .collection('users')
  .updateOne({ phone }, { $set: { isPlatformAdmin: !revoke } });

if (result.matchedCount === 0) {
  console.error(`No user with phone ${phone}. They must sign in once first.`);
  process.exitCode = 1;
} else {
  console.log(`${revoke ? 'Revoked' : 'Granted'} platform admin for ${phone}`);
}

await mongoose.disconnect();
