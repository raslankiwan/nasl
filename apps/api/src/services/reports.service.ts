import { daysBetween, standardisedYield, type TestDay } from '@nasl/shared';
import { Animal, type AnimalDoc } from '../models/animal.model.ts';
import { Birth, Weaning } from '../models/breeding.model.ts';
import { HealthEvent } from '../models/health.model.ts';
import { Lactation, MilkTestDay } from '../models/milk.model.ts';

/**
 * The reports that make recording worth doing.
 *
 * Everything here is derived from the event stream at read time rather than maintained as running
 * totals. Totals drift: a birth corrected six months later would leave a stale counter behind,
 * and the number a culling decision rests on has to be the one the events actually support.
 */

export interface EweRow {
  animalId: string;
  tagNumber: string;
  name: string | null;
  ageMonths: number | null;
  lambings: number;
  lambsBorn: number;
  lambsLive: number;
  lambsWeaned: number;
  averageLitterSize: number | null;
  /** Mean days between consecutive lambings. Null until she has lambed twice. */
  averageLambingIntervalDays: number | null;
  kgWeaned: number;
  assistedLambings: number;
  /** Best standardised 150-day lactation. Awassi is dual-purpose: her worth is lambs and litres. */
  bestLactationKg: number | null;
  lactations: number;
  lastLambedAt: string | null;
  daysSinceLastLambing: number | null;
  reproState: string | null;
  /** Why she is a candidate for culling, if she is. Empty means she is earning her feed. */
  cullSignals: string[];
}

/** A ewe who has not lambed in this long is, in practice, not in production. */
const STALE_LAMBING_DAYS = 400;

export class ReportsService {
  /**
   * Per-ewe lifetime productivity, worst first (FR-RPT-01).
   *
   * Sorted so the culling conversation starts at the top of the list rather than requiring the
   * herder to scan for it.
   */
  async eweScorecard(farmId: string, today = new Date()): Promise<EweRow[]> {
    const ewes = await Animal.find({
      farmId,
      deletedAt: null,
      sex: 'female',
      status: 'active',
    })
      .lean<AnimalDoc[]>()
      .exec();

    if (ewes.length === 0) return [];

    const eweIds = ewes.map((e) => e._id);
    const [births, weanings, lactations, testDays] = await Promise.all([
      Birth.find({ farmId, deletedAt: null, damId: { $in: eweIds } })
        .sort({ date: 1 })
        .lean()
        .exec(),
      Weaning.find({ farmId, deletedAt: null, damId: { $in: eweIds } })
        .lean()
        .exec(),
      Lactation.find({ farmId, deletedAt: null, animalId: { $in: eweIds } })
        .lean()
        .exec(),
      MilkTestDay.find({ farmId, deletedAt: null, animalId: { $in: eweIds } })
        .sort({ date: 1 })
        .lean()
        .exec(),
    ]);

    const birthsByDam = new Map<string, typeof births>();
    for (const birth of births) {
      const list = birthsByDam.get(birth.damId) ?? [];
      list.push(birth);
      birthsByDam.set(birth.damId, list);
    }

    const weanedByDam = new Map<string, { count: number; kg: number }>();
    for (const weaning of weanings) {
      const entry = weanedByDam.get(weaning.damId) ?? { count: 0, kg: 0 };
      entry.count += weaning.lambIds.length;
      entry.kg += Object.values(weaning.weightsKg ?? {}).reduce((sum, kg) => sum + kg, 0);
      weanedByDam.set(weaning.damId, entry);
    }

    // Best standardised lactation per ewe, so the scorecard ranks on milk as well as lambs.
    const testsByLactation = new Map<string, TestDay[]>();
    for (const test of testDays) {
      const list = testsByLactation.get(test.lactationId) ?? [];
      list.push({ date: test.date, kg: test.kg });
      testsByLactation.set(test.lactationId, list);
    }

    const milkByEwe = new Map<string, { best: number | null; count: number }>();
    for (const lactation of lactations) {
      const entry = milkByEwe.get(lactation.animalId) ?? { best: null, count: 0 };
      entry.count += 1;
      const yielded = standardisedYield(
        lactation.startDate,
        testsByLactation.get(lactation._id) ?? [],
        lactation.endDate ?? today,
      );
      if (yielded > 0 && (entry.best === null || yielded > entry.best)) entry.best = yielded;
      milkByEwe.set(lactation.animalId, entry);
    }

    const flockAverageLitter = this.mean(
      births.map((b) => b.offspring.length).filter((n) => n > 0),
    );

    const rows = ewes.map((ewe) =>
      this.buildRow(ewe, birthsByDam, weanedByDam, milkByEwe, flockAverageLitter, today),
    );

    /**
     * Worst first: most cull signals, then least productive. Productivity is lambs *and* litres —
     * a ewe who rears one lamb but milks well is not the one to cull, and ranking her on lambs
     * alone would say she is.
     */
    return rows.sort(
      (a, b) =>
        b.cullSignals.length - a.cullSignals.length ||
        (a.bestLactationKg ?? 0) - (b.bestLactationKg ?? 0) ||
        (a.averageLitterSize ?? 0) - (b.averageLitterSize ?? 0) ||
        a.lambsWeaned - b.lambsWeaned,
    );
  }

  private buildRow(
    ewe: AnimalDoc,
    birthsByDam: Map<
      string,
      Array<{
        date: Date;
        offspring: Array<{ outcome: string }>;
        assisted: boolean;
        difficulty: number;
      }>
    >,
    weanedByDam: Map<string, { count: number; kg: number }>,
    milkByEwe: Map<string, { best: number | null; count: number }>,
    flockAverageLitter: number | null,
    today: Date,
  ): EweRow {
    const herBirths = birthsByDam.get(ewe._id) ?? [];
    const weaned = weanedByDam.get(ewe._id) ?? { count: 0, kg: 0 };
    const milk = milkByEwe.get(ewe._id) ?? { best: null, count: 0 };

    const lambsBorn = herBirths.reduce((sum, b) => sum + b.offspring.length, 0);
    const lambsLive = herBirths.reduce(
      (sum, b) => sum + b.offspring.filter((o) => o.outcome === 'live').length,
      0,
    );
    const assisted = herBirths.filter((b) => b.assisted || b.difficulty >= 3).length;

    const intervals: number[] = [];
    for (let i = 1; i < herBirths.length; i += 1) {
      intervals.push(daysBetween(herBirths[i - 1]!.date, herBirths[i]!.date));
    }

    const last = herBirths.at(-1) ?? null;
    const daysSince = last ? daysBetween(last.date, today) : null;
    const ageMonths = ewe.dateOfBirth
      ? Math.floor(daysBetween(ewe.dateOfBirth, today) / 30.44)
      : null;

    const averageLitterSize = herBirths.length > 0 ? lambsBorn / herBirths.length : null;

    const cullSignals: string[] = [];
    if (ewe.repro?.state === 'barren') cullSignals.push('barren');
    if (herBirths.length === 0 && (ageMonths ?? 0) >= 24) cullSignals.push('neverLambed');
    if (daysSince !== null && daysSince > STALE_LAMBING_DAYS) cullSignals.push('longSinceLambing');
    if (assisted >= 2) cullSignals.push('repeatedDifficulty');
    if (lambsBorn > 0 && lambsLive < lambsBorn / 2) cullSignals.push('poorSurvival');
    if (
      averageLitterSize !== null &&
      flockAverageLitter !== null &&
      herBirths.length >= 2 &&
      averageLitterSize < flockAverageLitter * 0.75
    ) {
      cullSignals.push('belowFlockLitterSize');
    }

    return {
      animalId: ewe._id,
      tagNumber: ewe.tagNumber,
      name: ewe.name ?? null,
      ageMonths,
      lambings: herBirths.length,
      lambsBorn,
      lambsLive,
      lambsWeaned: weaned.count,
      averageLitterSize: averageLitterSize === null ? null : Number(averageLitterSize.toFixed(2)),
      averageLambingIntervalDays: intervals.length > 0 ? Math.round(this.mean(intervals)!) : null,
      kgWeaned: Number(weaned.kg.toFixed(1)),
      assistedLambings: assisted,
      bestLactationKg: milk.best,
      lactations: milk.count,
      lastLambedAt: last ? last.date.toISOString().slice(0, 10) : null,
      daysSinceLastLambing: daysSince,
      reproState: ewe.repro?.state ?? null,
      cullSignals,
    };
  }

  /** Season headline numbers (FR-RPT-02). */
  async seasonSummary(farmId: string, from: Date, to: Date) {
    const births = await Birth.find({
      farmId,
      deletedAt: null,
      date: { $gte: from, $lte: to },
    })
      .lean()
      .exec();

    const offspring = births.flatMap((b) => b.offspring);
    const live = offspring.filter((o) => o.outcome === 'live').length;
    const stillborn = offspring.filter((o) => o.outcome === 'stillborn').length;
    const died = offspring.filter((o) => o.outcome === 'died24h').length;

    const damsThatLambed = new Set(births.map((b) => b.damId)).size;
    const weanings = await Weaning.find({
      farmId,
      deletedAt: null,
      date: { $gte: from, $lte: to },
    })
      .lean()
      .exec();
    const weaned = weanings.reduce((sum, w) => sum + w.lambIds.length, 0);

    const birthWeights = offspring
      .map((o) => o.birthWeightKg)
      .filter((kg): kg is number => typeof kg === 'number');

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      lambings: births.length,
      damsThatLambed,
      lambsBorn: offspring.length,
      lambsLive: live,
      stillborn,
      diedWithin24h: died,
      lambsWeaned: weaned,
      /** Lambs born per dam that lambed, as a percentage — the standard measure. */
      lambingPercentage:
        damsThatLambed > 0 ? Math.round((offspring.length / damsThatLambed) * 100) : null,
      weaningRate: live > 0 ? Math.round((weaned / live) * 100) : null,
      lambMortality:
        offspring.length > 0 ? Math.round(((stillborn + died) / offspring.length) * 100) : null,
      averageBirthWeightKg: this.round(this.mean(birthWeights), 2),
      assistedLambings: births.filter((b) => b.assisted || b.difficulty >= 3).length,
    };
  }

  /** Who is in the flock right now (FR-RPT-03). */
  async flockComposition(farmId: string, today = new Date()) {
    const animals = await Animal.find({ farmId, deletedAt: null, status: 'active' })
      .lean<AnimalDoc[]>()
      .exec();

    const tally = <T extends string>(values: T[]) =>
      values.reduce<Record<string, number>>((acc, v) => {
        acc[v] = (acc[v] ?? 0) + 1;
        return acc;
      }, {});

    const ageBand = (animal: AnimalDoc): string => {
      if (!animal.dateOfBirth) return 'unknown';
      const months = daysBetween(animal.dateOfBirth, today) / 30.44;
      if (months < 6) return 'lamb';
      if (months < 12) return 'hogget';
      if (months < 48) return 'mature';
      return 'aged';
    };

    return {
      total: animals.length,
      bySex: tally(animals.map((a) => a.sex)),
      bySpecies: tally(animals.map((a) => a.species)),
      byBreed: tally(animals.map((a) => a.breedId ?? 'unknown')),
      byAgeBand: tally(animals.map(ageBand)),
      byReproState: tally(
        animals.filter((a) => a.sex === 'female').map((a) => a.repro?.state ?? 'open'),
      ),
    };
  }

  /** Every medicine given in a period, for the compliance record (FR-RPT-04). */
  async treatmentRegister(farmId: string, from: Date, to: Date) {
    const events = await HealthEvent.find({
      farmId,
      deletedAt: null,
      date: { $gte: from, $lte: to },
    })
      .sort({ date: -1 })
      .lean()
      .exec();

    const animalIds = [...new Set(events.map((e) => e.animalId))];
    const animals = await Animal.find({ farmId, _id: { $in: animalIds } })
      .select('tagNumber')
      .lean<Array<{ _id: string; tagNumber: string }>>()
      .exec();
    const tagById = new Map(animals.map((a) => [a._id, a.tagNumber]));

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      entries: events.map((e) => ({
        date: e.date.toISOString().slice(0, 10),
        tagNumber: tagById.get(e.animalId) ?? '—',
        type: e.type,
        product: e.productName ?? null,
        batchNo: e.batchNo ?? null,
        doseValue: e.doseValue ?? null,
        doseUnit: e.doseUnit ?? null,
        route: e.route ?? null,
        administeredBy: e.administeredBy,
        withholdMeatUntil: e.withholdMeatUntil?.toISOString().slice(0, 10) ?? null,
        withholdMilkUntil: e.withholdMilkUntil?.toISOString().slice(0, 10) ?? null,
      })),
    };
  }

  private mean(values: number[]): number | null {
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  }

  private round(value: number | null, places: number): number | null {
    return value === null ? null : Number(value.toFixed(places));
  }
}
