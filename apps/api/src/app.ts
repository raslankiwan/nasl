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
import { financeRoutes } from './routes/finance.routes.ts';
import { inventoryRoutes } from './routes/inventory.routes.ts';
import { milkRoutes } from './routes/milk.routes.ts';
import type { VerificationMailer } from './auth/verificationEmail.ts';
import type { InvitationMailer } from './auth/invitationEmail.ts';

import { notificationRoutes, notificationCron } from './notifications/routes.ts';
import { webPushSender, type PushSender } from './notifications/push.ts';

export interface AppDeps {
  config: Config;
  logger: Logger;
  invitationMailer?: InvitationMailer;
  pushSender?: PushSender;
  verificationMailer?: VerificationMailer;
}

/**
 * Build the Express app without binding a port, so tests can drive it directly.
 */
export function createApp({
  config,
  logger,
  invitationMailer,
  verificationMailer,
  pushSender,
}: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  const allowedOrigins = config.CORS_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: config.NODE_ENV === 'production' ? allowedOrigins : true,
    }),
  );
  // Farm and account responses must never enter a shared CDN cache.
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  if (config.NODE_ENV !== 'test') {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  const sendPush = pushSender ?? webPushSender(config);
  app.use('/v1/notifications', notificationRoutes(config, sendPush));
  app.use('/v1/cron', notificationCron(config, sendPush, logger));
  app.use('/v1/auth', authRoutes(config, verificationMailer));
  app.use('/v1/reference', referenceRoutes(config));
  app.use('/v1/admin', adminRoutes(config, invitationMailer));
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
  app.use('/v1/farms/:farmId/finance', financeRoutes(config));
  app.use('/v1/farms/:farmId/inventory', inventoryRoutes(config));
  app.use('/v1/farms/:farmId/milk', milkRoutes(config));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
