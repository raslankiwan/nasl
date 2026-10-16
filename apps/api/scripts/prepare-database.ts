import '../src/models/index.ts';
import { loadConfig } from '../src/config.ts';
import { preparePasswordAccounts } from '../src/migrations/passwordAccounts.ts';
import { connectDatabase, disconnectDatabase, ensureIndexes } from '../src/db.ts';
import { createLogger } from '../src/logger.ts';

const config = loadConfig();
try {
  await connectDatabase(config.MONGODB_URI, createLogger('info', false), {
    createIndexes: false,
    maxPoolSize: config.MONGO_MAX_POOL_SIZE,
    dbName: config.MONGODB_DB_NAME,
  });
  await preparePasswordAccounts();
  await ensureIndexes();
} finally {
  await disconnectDatabase();
}
