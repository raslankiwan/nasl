import { connectDatabase, disconnectDatabase } from '../src/db.ts';
import { createLogger } from '../src/logger.ts';
import { EmailVerification } from '../src/models/emailVerification.model.ts';
import { Passkey, PasskeyChallenge } from '../src/models/passkey.model.ts';
import { User } from '../src/models/user.model.ts';

// No secret values or recipient details are printed. Approved legacy accounts keep access.
if (!process.env.MONGODB_URI) throw new Error('Load MONGODB_URI securely first.');
try {
  await connectDatabase(process.env.MONGODB_URI, createLogger('silent', false), {
    createIndexes: false,
    dbName: process.env.MONGODB_DB_NAME,
  });
  await EmailVerification.createIndexes();
  await Passkey.createIndexes();
  await PasskeyChallenge.createIndexes();
  const result = await User.updateMany(
    {
      status: { $in: ['pending', 'rejected'] },
      isPlatformAdmin: false,
      email: { $type: 'string' },
      emailVerifiedAt: null,
    },
    { $set: { emailVerificationRequired: true } },
  );
  console.log(
    `Authentication indexes ready; ${result.modifiedCount} pending/rejected accounts now require email verification. Approved accounts preserved.`,
  );
} finally {
  await disconnectDatabase();
}
