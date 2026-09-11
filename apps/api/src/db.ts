import mongoose from 'mongoose';
import type { Logger } from './logger.ts';

/**
 * Mongoose settings shared by the server and the tests.
 *
 * Tests must connect through this too: a setting applied only in production is a setting no test
 * can catch, and that is exactly how `sanitizeFilter` shipped a 500 into the admin console.
 */
export function applyMongooseSettings(): void {
  mongoose.set('strictQuery', true);

  /**
   * `sanitizeFilter` is deliberately NOT enabled.
   *
   * It wraps any filter value containing `$` in `$eq`, which defeats query-selector injection but
   * also breaks every legitimate server-authored operator — `{ _id: { $in: [...] } }` becomes
   * `{ _id: { $eq: { $in: [...] } } }` and throws a CastError.
   *
   * The protection it offers is already provided, more precisely, elsewhere: every request body
   * and query string is parsed by zod, so a client cannot deliver an object where a string is
   * expected; free-text search is escaped before it reaches a regex; and TenantRepository refuses
   * `$where` and forces `farmId` into every filter.
   */
}

/**
 * Build every model's indexes and wait for them.
 *
 * Mongoose creates indexes in the background, so a freshly started process will happily accept
 * writes before its unique indexes exist — and tag uniqueness (FR-REG-02) is enforced *by* an
 * index. Serving traffic before they are ready means duplicates slip through at startup.
 */
export async function ensureIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
}

export async function connectDatabase(uri: string, logger: Logger): Promise<void> {
  applyMongooseSettings();

  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(uri);
  await ensureIndexes();
  logger.info('MongoDB connected');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
