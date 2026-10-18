import { adjustedWeight, averageDailyGain, lifetimeGain, type WeightPoint } from '@nasl/shared';
import { AppError } from '../errors.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';
import { Weight, type WeightDoc } from '../models/weight.model.ts';
import { Birth } from '../models/breeding.model.ts';

/**
 * Weights and what they mean (M6).
 *
 * The arithmetic itself lives in `@nasl/shared` so the phone can show a gain without a round trip.
 * This service's job is to fetch the right points and keep the animal's `lastWeightKg` in step.
 */
export class WeightsService {
  private readonly animals = new AnimalRepository();
  private readonly weights = new TenantRepository<WeightDoc>(Weight);

  async record(
    farmId: string,
    input: { id?: string; animalId: string; date: Date; kg: number; method: string },
    recordedBy: string,
  ) {
    const previous = input.id ? await this.weights.findById(farmId, input.id) : null;
    if (previous) return previous;

    const animal = await this.animals.findById(farmId, input.animalId);
    if (!animal) throw AppError.notFound('That animal is not in this flock.');

    const weighing = await this.weights.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      animalId: input.animalId,
      date: input.date,
      kg: input.kg,
      method: input.method,
      recordedBy,
    } as Partial<WeightDoc>);

    // `lastWeightKg` is a convenience for the roster, so it must reflect the latest weighing by
    // date — not simply the most recently entered one, which may be a backfill.
    const latest = await this.weights.findOne(farmId, { animalId: input.animalId } as never, {
      sort: { date: -1, createdAt: -1, _id: -1 },
    });
    if (latest) {
      await this.animals.updateById(farmId, input.animalId, {
        $set: { lastWeightKg: latest.kg },
      });
    }

    return weighing;
  }

  /** Bulk weighing — a whole pen through the race in one session (FR-WGT-01). */
  async recordMany(
    farmId: string,
    input: { date: Date; method: string; weights: Array<{ animalId: string; kg: number }> },
    recordedBy: string,
  ) {
    const recorded: WeightDoc[] = [];
    for (const entry of input.weights) {
      try {
        recorded.push(
          await this.record(
            farmId,
            { animalId: entry.animalId, date: input.date, kg: entry.kg, method: input.method },
            recordedBy,
          ),
        );
      } catch {
        // One animal missing from the farm must not discard the rest of the session.
      }
    }
    return recorded;
  }

  /** An animal's weighings with the gains between them (FR-WGT-02, 03). */
  async historyFor(farmId: string, animalId: string) {
    const animal = await this.animals.findById(farmId, animalId);
    if (!animal) throw AppError.notFound('That animal is not in this flock.');

    const weighings = await this.weights.find(farmId, { animalId } as never, {
      sort: { date: 1, createdAt: 1, _id: 1 },
    });

    const points: WeightPoint[] = weighings.map((w) => ({ date: w.date, kg: w.kg }));

    const entries = weighings.map((w, index) => ({
      id: w._id,
      date: w.date.toISOString().slice(0, 10),
      kg: w.kg,
      method: w.method,
      /** Gain since the previous weighing — what the herder actually wants to see in a list. */
      gainPerDay: index === 0 ? null : averageDailyGain(points[index - 1]!, points[index]!),
    }));

    // Birth weight comes from the birth record, not from a weighing, so the adjusted figure works
    // for a lamb that has only been weighed once.
    const birth = await Birth.findOne({ farmId, deletedAt: null, 'offspring.animalId': animalId })
      .lean()
      .exec();
    const birthWeight =
      birth?.offspring.find((o) => o.animalId === animalId)?.birthWeightKg ?? null;

    const last = points.at(-1) ?? null;
    const adjusted90 =
      birthWeight && last && animal.dateOfBirth
        ? adjustedWeight(birthWeight, last, animal.dateOfBirth, 90)
        : null;

    return {
      animalId,
      tagNumber: animal.tagNumber,
      birthWeightKg: birthWeight,
      current: last?.kg ?? null,
      lifetimeGainPerDay: lifetimeGain(points),
      adjusted90DayWeightKg: adjusted90,
      entries,
    };
  }
}
