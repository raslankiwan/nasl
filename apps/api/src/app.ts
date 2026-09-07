import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.ts';
import type { Logger } from './logger.ts';
import { errorHandler, notFoundHandler } from './errors.ts';
import { authRoutes } from './auth/auth.routes.ts';
import { farmRoutes } from './routes/farms.routes.ts';

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
  app.use('/v1/farms', farmRoutes(config));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
