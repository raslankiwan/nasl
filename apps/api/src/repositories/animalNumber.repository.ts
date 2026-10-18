import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { AppError } from '../errors.ts';
import { AnimalNumber, type AnimalNumberDoc } from '../models/animalNumber.model.ts';
import { TenantRepository } from './tenantRepository.ts';

/** A farm-local sequence. Gaps are allowed; an allocated number is never reassigned. */
export class AnimalNumberRepository extends TenantRepository<AnimalNumberDoc> {
  constructor(session?: ClientSession) {
    super(AnimalNumber, undefined, session);
  }

  async advanceTo(farmId: string, minimum: number) {
    try {
      await this.model.updateOne(
        this.scope(farmId),
        {
          $max: { lastNumber: minimum },
          $setOnInsert: { _id: randomUUID() },
        },
        { upsert: true, setDefaultsOnInsert: false, session: this.session },
      );
    } catch (error) {
      // Concurrent first registrations can race the upsert. Transactions retry as a whole.
      if ((error as { code?: number }).code !== 11000 || this.session) throw error;
      await this.model.updateOne(this.scope(farmId), { $max: { lastNumber: minimum } });
    }
  }

  async next(farmId: string): Promise<string> {
    const counter = await this.model
      .findOneAndUpdate(
        this.scope(farmId, { lastNumber: { $lt: Number.MAX_SAFE_INTEGER } }),
        { $inc: { lastNumber: 1 } },
        { new: true, session: this.session },
      )
      .lean();
    if (!counter)
      throw AppError.conflict('No automatic animal numbers are available. Enter a unique tag.');
    return String(counter.lastNumber);
  }
}
