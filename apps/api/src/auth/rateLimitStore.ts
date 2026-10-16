import { createHash } from 'node:crypto';
import type { Store } from 'express-rate-limit';
import { RateLimit } from '../models/rateLimit.model.ts';

/** Share authentication limits across functions using the existing database, without another service. */
export function mongoRateLimitStore(prefix: string): Store {
  let windowMs = 15 * 60_000;
  const id = (key: string) => `${prefix}:${createHash('sha256').update(key).digest('hex')}`;
  return {
    prefix,
    localKeys: false,
    init(options) {
      windowMs = options.windowMs;
    },
    async increment(key) {
      const now = new Date();
      const expired = { $lte: [{ $ifNull: ['$expiresAt', new Date(0)] }, now] };
      const update = [
        {
          $set: {
            hits: { $cond: [expired, 1, { $add: ['$hits', 1] }] },
            expiresAt: { $cond: [expired, new Date(now.getTime() + windowMs), '$expiresAt'] },
          },
        },
      ];
      // Two cold instances can both upsert a new key. The unique _id chooses one; retry the loser.
      const increment = () =>
        RateLimit.findOneAndUpdate({ _id: id(key) }, update, { upsert: true, new: true }).lean();
      let counter;
      try {
        counter = await increment();
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        counter = await increment();
      }
      return { totalHits: counter!.hits, resetTime: counter!.expiresAt };
    },
    async decrement(key) {
      await RateLimit.updateOne({ _id: id(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } });
    },
    async resetKey(key) {
      await RateLimit.deleteOne({ _id: id(key) });
    },
  };
}
