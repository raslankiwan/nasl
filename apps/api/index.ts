import express from 'express';
import { createApp } from './src/app.ts';
import { loadConfig } from './src/config.ts';
import { connectDatabase } from './src/db.ts';
import { errorHandler } from './src/errors.ts';
import { createLogger } from './src/logger.ts';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, false);
const app = express();

// One shared connection promise per warm function, including concurrent cold-start requests.
app.use(async (_req, _res, next) => {
  await connectDatabase(config.MONGODB_URI, logger, {
    createIndexes: false,
    maxPoolSize: config.MONGO_MAX_POOL_SIZE,
    dbName: config.MONGODB_DB_NAME,
  });
  next();
});
app.use(createApp({ config, logger }));
app.use(errorHandler(logger));

export default app;
