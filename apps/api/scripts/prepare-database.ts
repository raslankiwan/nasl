import '../src/models/index.ts';
import { loadConfig } from '../src/config.ts';
import { connectDatabase, disconnectDatabase } from '../src/db.ts';
import { createLogger } from '../src/logger.ts';

const config = loadConfig();
try {
  await connectDatabase(config.MONGODB_URI, createLogger('info', false), {
    createIndexes: true,
    maxPoolSize: config.MONGO_MAX_POOL_SIZE,
    dbName: config.MONGODB_DB_NAME,
  });
} finally {
  await disconnectDatabase();
}
