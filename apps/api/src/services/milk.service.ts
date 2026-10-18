import type { ClientSession } from 'mongoose';
import {
  averageDailyYield,
  daysInMilk,
  isUnderMilkWithdrawal,
  lactationYield,
  outputPlausibility,
  peakYield,
  standardisedYield,
  summariseDispositions,
  type MilkRoute,
  type TestDay,
} from '@nasl/shared';
import { AppError } from '../errors.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';
import {
  Lactation,
  MilkCollection,
  MilkDisposition,
  MilkTestDay,
  type LactationDoc,
  type MilkCollectionDoc,
  type MilkDispositionDoc,
  type MilkTestDayDoc,
} from '../models/milk.model.ts';
import { Farm } from '../models/farm.model.ts';

export interface LactationSummary {
  lactationId: string;
  animalId: string;
  tagNumber: string;
  name: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  daysInMilk: number;
  testDays: number;
  totalKg: number;
  standardised150Kg: number;
  peakKg: number | null;
  averageDailyKg: number | null;
}

/**
 * Milk (M8-adjacent, added for the Palestinian market).
 *
 * Awassi is dual-purpose and most of the flock here is milked, so a ewe's worth is her lambs *and*
 * her litres. Per-ewe yield comes from periodic test days rather than every milking, because
 * weighing eighty ewes twice a day is not something a farm outside a selection scheme will do.
 */
export class MilkService {
  private readonly animals: AnimalRepository;
  private readonly lactations: TenantRepository<LactationDoc>;
  private readonly testDays: TenantRepository<MilkTestDayDoc>;
  private readonly collections: TenantRepository<MilkCollectionDoc>;
  private readonly dispositions: TenantRepository<MilkDispositionDoc>;

  constructor(session?: ClientSession) {
    this.animals = new AnimalRepository(undefined, session);
    this.lactations = new TenantRepository(Lactation, undefined, session);
    this.testDays = new TenantRepository(MilkTestDay, undefined, session);
    this.collections = new TenantRepository(MilkCollection, undefined, session);
    this.dispositions = new TenantRepository(MilkDisposition, undefined, session);
  }

  /** Opened by the birth flow. A ewe that has lambed is in milk whether or not she is weighed. */
  async openLactation(
    farmId: string,
    input: { animalId: string; birthId?: string; startDate: Date },
    recordedBy: string,
  ) {
    const open = await this.lactations.findOne(farmId, {
      animalId: input.animalId,
      status: 'milking',
    } as never);
    // Lambing again without drying off closes the previous one on the new lambing date.
    if (open) {
      await this.lactations.updateById(farmId, open._id, {
        $set: { endDate: input.startDate, status: 'dried' },
      });
    }

    return this.lactations.create(farmId, {
      animalId: input.animalId,
      birthId: input.birthId ?? null,
      startDate: input.startDate,
      status: 'milking',
      recordedBy,
    } as Partial<LactationDoc>);
  }

  async dryOff(farmId: string, animalId: string, date: Date) {
    const open = await this.lactations.findOne(farmId, {
      animalId,
      status: 'milking',
    } as never);
    if (!open) throw AppError.conflict('She is not recorded as milking.');

    return this.lactations.updateById(farmId, open._id, {
      $set: { endDate: date, status: 'dried' },
    });
  }

  /**
   * Record a test day for a group of ewes.
   *
   * A ewe under a milk withdrawal is recorded but reported back, because her milk must not reach
   * the tank — and the moment someone is standing at the parlour writing down yields is exactly
   * when that needs saying.
   */
  async recordTestDay(
    farmId: string,
    input: { date: Date; entries: Array<{ animalId: string; kg: number }> },
    recordedBy: string,
  ) {
    const recorded: MilkTestDayDoc[] = [];
    const withheld: Array<{ animalId: string; tagNumber: string; until: string }> = [];
    const skipped: string[] = [];

    for (const entry of input.entries) {
      const animal = await this.animals.findById(farmId, entry.animalId);
      if (!animal) {
        skipped.push(entry.animalId);
        continue;
      }

      let lactation = await this.lactations.findOne(farmId, {
        animalId: entry.animalId,
        status: 'milking',
      } as never);

      // A ewe being milked with no lactation on record is a gap in the history, not a reason to
      // refuse the measurement. Open one from what we know.
      lactation ??= await this.openLactation(
        farmId,
        { animalId: entry.animalId, startDate: animal.repro?.sinceDate ?? input.date },
        recordedBy,
      );

      const existing = await this.testDays.findOne(farmId, {
        animalId: entry.animalId,
        date: input.date,
      } as never);

      const saved = existing
        ? await this.testDays.updateById(farmId, existing._id, { $set: { kg: entry.kg } })
        : await this.testDays.create(farmId, {
            lactationId: lactation._id,
            animalId: entry.animalId,
            date: input.date,
            kg: entry.kg,
            recordedBy,
          } as Partial<MilkTestDayDoc>);

      if (saved) recorded.push(saved);

      if (
        isUnderMilkWithdrawal(
          { withholdMilkUntil: animal.withholdMilkUntil?.toISOString() ?? undefined },
          input.date,
        )
      ) {
        withheld.push({
          animalId: animal._id,
          tagNumber: animal.tagNumber,
          until: animal.withholdMilkUntil!.toISOString().slice(0, 10),
        });
      }
    }

    return { recorded: recorded.length, withheld, skipped };
  }

  /** What went into the churn. */
  async recordCollection(
    farmId: string,
    input: { id?: string; date: Date; session: string; qtyKg: number; note?: string },
    recordedBy: string,
  ) {
    const previous = input.id ? await this.collections.findById(farmId, input.id) : null;
    if (previous) return previous;

    return this.collections.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      date: input.date,
      session: input.session,
      qtyKg: input.qtyKg,
      note: input.note ?? null,
      recordedBy,
    } as Partial<MilkCollectionDoc>);
  }

  /** One ewe's lactations, newest first, each estimated from its test days. */
  async lactationsFor(farmId: string, animalId: string, today = new Date()) {
    const animal = await this.animals.findById(farmId, animalId);
    if (!animal) throw AppError.notFound('That animal is not in this flock.');

    const lactations = await this.lactations.find(farmId, { animalId } as never, {
      sort: { startDate: -1 },
    });
    const tests = await this.testDays.find(farmId, { animalId } as never, { sort: { date: 1 } });

    return lactations.map((lactation) =>
      this.summarise(
        lactation,
        tests.filter((t) => t.lactationId === lactation._id),
        animal.tagNumber,
        animal.name ?? null,
        today,
      ),
    );
  }

  private summarise(
    lactation: LactationDoc,
    tests: MilkTestDayDoc[],
    tagNumber: string,
    name: string | null,
    today: Date,
  ): LactationSummary {
    const points: TestDay[] = tests.map((t) => ({ date: t.date, kg: t.kg }));
    const end = lactation.endDate ?? today;

    return {
      lactationId: lactation._id,
      animalId: lactation.animalId,
      tagNumber,
      name,
      startDate: lactation.startDate.toISOString().slice(0, 10),
      endDate: lactation.endDate?.toISOString().slice(0, 10) ?? null,
      status: lactation.status,
      daysInMilk: daysInMilk(lactation.startDate, end),
      testDays: points.length,
      totalKg: lactationYield(lactation.startDate, points, end),
      standardised150Kg: standardisedYield(lactation.startDate, points, end),
      peakKg: peakYield(points),
      averageDailyKg: averageDailyYield(lactation.startDate, points, end),
    };
  }

  /** Every ewe currently milking, best first — the other half of the scorecard. */
  async milkingFlock(farmId: string, today = new Date()): Promise<LactationSummary[]> {
    const lactations = await this.lactations.find(farmId, { status: 'milking' } as never, {
      limit: 500,
    });
    if (lactations.length === 0) return [];

    const animalIds = lactations.map((l) => l.animalId);
    const [animals, tests] = await Promise.all([
      this.animals.find(farmId, { _id: { $in: animalIds } } as never, { limit: 500 }),
      this.testDays.find(farmId, { animalId: { $in: animalIds } } as never, { limit: 5000 }),
    ]);
    const byId = new Map(animals.map((a) => [a._id, a]));

    return lactations
      .map((lactation) => {
        const animal = byId.get(lactation.animalId);
        return this.summarise(
          lactation,
          tests.filter((t) => t.lactationId === lactation._id),
          animal?.tagNumber ?? '—',
          animal?.name ?? null,
          today,
        );
      })
      .sort((a, b) => b.standardised150Kg - a.standardised150Kg);
  }

  /** Tank totals for a period — the flock's milk income line. */
  async collectionSummary(farmId: string, from: Date, to: Date) {
    const rows = await this.collections.find(farmId, { date: { $gte: from, $lte: to } } as never, {
      sort: { date: -1 },
      limit: 1000,
    });
    const totalKg = rows.reduce((sum, r) => sum + r.qtyKg, 0);
    const days = new Set(rows.map((r) => r.date.toISOString().slice(0, 10))).size;

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totalKg: Number(totalKg.toFixed(1)),
      days,
      averagePerDayKg: days > 0 ? Number((totalKg / days).toFixed(1)) : null,
      collections: rows.map((r) => ({
        id: r._id,
        date: r.date.toISOString().slice(0, 10),
        session: r.session,
        qtyKg: r.qtyKg,
      })),
    };
  }

  /**
   * What a batch of milk became — sold raw, set for cheese, soured for laban, or kept.
   *
   * A cheese batch whose output is implausible for the milk that went in is flagged back to the
   * caller and still saved. The entry is the farm's to make; the point is to ask the question
   * while someone is standing there, because a slipped decimal is untraceable a month later.
   */
  async recordDisposition(
    farmId: string,
    input: {
      id?: string;
      date: Date;
      collectionId?: string;
      route: MilkRoute;
      milkKg: number;
      outputKg?: number;
      revenue?: number;
      paid?: boolean;
      buyer?: string;
      note?: string;
    },
    recordedBy: string,
  ) {
    const previous = input.id ? await this.dispositions.findById(farmId, input.id) : null;
    if (previous)
      return {
        disposition: previous,
        plausibility: outputPlausibility(
          previous.route as MilkRoute,
          previous.milkKg,
          previous.outputKg ?? undefined,
        ),
      };

    const farm = await Farm.findById(farmId).select('currency').lean().exec();

    const saved = await this.dispositions.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      date: input.date,
      collectionId: input.collectionId ?? null,
      route: input.route,
      milkKg: input.milkKg,
      outputKg: input.outputKg ?? null,
      revenue: input.revenue ?? null,
      currency: farm?.currency ?? 'ILS',
      paid: input.paid ?? true,
      buyer: input.buyer ?? null,
      note: input.note ?? null,
      recordedBy,
    } as Partial<MilkDispositionDoc>);

    return {
      disposition: saved,
      plausibility: outputPlausibility(input.route, input.milkKg, input.outputKg),
    };
  }

  /**
   * Which route paid best over a period (FR-MLK-06).
   *
   * The tank total for the same period is read alongside so milk that was collected and never
   * accounted for shows as a gap. A farm losing thirty kilos a week wants to be told.
   */
  async dispositionSummary(farmId: string, from: Date, to: Date) {
    const range = { date: { $gte: from, $lte: to } };
    const [rows, collected] = await Promise.all([
      this.dispositions.find(farmId, range as never, { sort: { date: -1 }, limit: 2000 }),
      this.collections.find(farmId, range as never, { limit: 2000 }),
    ]);

    const collectedKg = collected.reduce((total, c) => total + c.qtyKg, 0);
    const summary = summariseDispositions(
      rows.map((r) => ({
        route: r.route as MilkRoute,
        milkKg: r.milkKg,
        outputKg: r.outputKg,
        revenue: r.revenue,
      })),
      collected.length > 0 ? collectedKg : null,
    );

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      collectedKg: Number(collectedKg.toFixed(1)),
      ...summary,
      batches: rows.map((r) => ({
        id: r._id,
        date: r.date.toISOString().slice(0, 10),
        route: r.route,
        milkKg: r.milkKg,
        outputKg: r.outputKg,
        revenue: r.revenue,
        paid: r.paid,
        buyer: r.buyer,
      })),
    };
  }
}
