import express from 'express';
import { createApp } from './dist/app.js';
import { loadConfig } from './dist/config.js';
import { connectDatabase } from './dist/db.js';
import { errorHandler } from './dist/errors.js';
import { createLogger } from './dist/logger.js';

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
