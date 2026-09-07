import mongoose from 'mongoose';
import type { Logger } from './logger.ts';

export async function connectDatabase(uri: string, logger: Logger): Promise<void> {
  mongoose.set('strictQuery', true);
  // A query that silently omits its tenant filter is worse than a slow one; sanitise by default.
  mongoose.set('sanitizeFilter', true);

  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(uri);
  logger.info('MongoDB connected');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
