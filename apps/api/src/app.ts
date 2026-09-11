import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.ts';
import type { Logger } from './logger.ts';
import { errorHandler, notFoundHandler } from './errors.ts';
// Registers every model, so index creation covers all of them.
import './models/index.ts';
import { authRoutes } from './auth/auth.routes.ts';
import { farmRoutes } from './routes/farms.routes.ts';
import { animalRoutes } from './routes/animals.routes.ts';
import { groupRoutes, movementRoutes } from './routes/groups.routes.ts';
import { referenceRoutes } from './routes/reference.routes.ts';
import { adminRoutes } from './routes/admin.routes.ts';
import { breedingRoutes } from './routes/breeding.routes.ts';
import { healthRoutes } from './routes/health.routes.ts';
import { syncRoutes } from './routes/sync.routes.ts';
import { reportRoutes } from './routes/reports.routes.ts';
import { weightRoutes } from './routes/weights.routes.ts';
import { exportRoutes } from './routes/export.routes.ts';

export interface AppDeps {
  config: Config;
  logger: Logger;
}

/**
 * Build the Express app without binding a port, so tests can drive it directly.
 */
export function createApp({ config, logger }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  if (config.NODE_ENV !== 'test') {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  app.use('/v1/auth', authRoutes(config, logger));
  app.use('/v1/reference', referenceRoutes(config));
  app.use('/v1/admin', adminRoutes(config));
  app.use('/v1/farms', farmRoutes(config));
  app.use('/v1/farms/:farmId/animals', animalRoutes(config));
  app.use('/v1/farms/:farmId/animals', movementRoutes(config));
  app.use('/v1/farms/:farmId/groups', groupRoutes(config));
  app.use('/v1/farms/:farmId/breeding', breedingRoutes(config));
  app.use('/v1/farms/:farmId/health', healthRoutes(config));
  app.use('/v1/farms/:farmId/sync', syncRoutes(config));
  app.use('/v1/farms/:farmId/reports', reportRoutes(config));
  app.use('/v1/farms/:farmId/weights', weightRoutes(config));
  app.use('/v1/farms/:farmId/export', exportRoutes(config));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
