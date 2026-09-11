import {
  applyReproEvent,
  expectedDueDate,
  InvalidReproTransition,
  isInDueWindow,
  type ReproEvent,
  type ReproState,
  type ReproStatus,
  type Species,
} from '@nasl/shared';
import { AppError } from '../errors.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';
import type { AnimalDoc } from '../models/animal.model.ts';
import {
  Abortion,
  Birth,
  Mating,
  PregnancyCheck,
  Weaning,
  type AbortionDoc,
  type BirthDoc,
  type MatingDoc,
  type OffspringRecord,
  type PregnancyCheckDoc,
  type WeaningDoc,
} from '../models/breeding.model.ts';

/**
 * The reproductive workflow.
 *
 * Every method writes an immutable event and then recomputes the female's derived `repro` state
 * from it. The state machine itself lives in `@nasl/shared`, so the device and the server reach
 * identical conclusions from the same events — the property offline sync will rest on.
 */
export class BreedingService {
  private readonly animals = new AnimalRepository();
  private readonly matings = new TenantRepository<MatingDoc>(Mating);
  private readonly checks = new TenantRepository<PregnancyCheckDoc>(PregnancyCheck);
  private readonly births = new TenantRepository<BirthDoc>(Birth);
  private readonly weanings = new TenantRepository<WeaningDoc>(Weaning);
  private readonly abortions = new TenantRepository<AbortionDoc>(Abortion);

  private async loadDam(farmId: string, damId: string): Promise<AnimalDoc> {
    const dam = await this.animals.findById(farmId, damId);
    if (!dam) throw AppError.notFound('That female is not in this flock.');
    if (dam.sex !== 'female') throw AppError.badRequest('Only a female carries a pregnancy.');
    if (dam.status !== 'active') {
      throw AppError.conflict('That animal is no longer in the working flock.');
    }
    return dam;
  }

  private currentStatus(dam: AnimalDoc): ReproStatus {
    if (dam.repro) {
      return {
        state: dam.repro.state as ReproStatus['state'],
        sinceDate: dam.repro.sinceDate,
        ...(dam.repro.matingId ? { matingId: dam.repro.matingId } : {}),
        ...(dam.repro.dueDate ? { dueDate: dam.repro.dueDate } : {}),
      };
    }
    // A female with no recorded history is open from the day she was registered.
    return { state: 'open', sinceDate: dam.createdAt };
  }

  /**
   * Apply an event, turning an impossible transition into a 409 the client can show. The state
   * machine is the authority on what may follow what; this only renders its refusal.
   */
  private advance(current: ReproStatus, event: ReproEvent): ReproStatus {
    try {
      return applyReproEvent(current, event);
    } catch (err) {
      if (err instanceof InvalidReproTransition) {
        throw AppError.conflict(err.message, { from: err.from, event: err.event });
      }
      throw err;
    }
  }

  private async persist(farmId: string, damId: string, next: ReproStatus): Promise<void> {
    await this.animals.updateById(farmId, damId, {
      $set: {
        repro: {
          state: next.state,
          sinceDate: next.sinceDate,
          matingId: next.matingId ?? null,
          dueDate: next.dueDate ?? null,
        },
      },
    });
  }

  // ---------------------------------------------------------------- mating --

  async recordMating(
    farmId: string,
    input: {
      /** Minted by the device, so a retry after a dropped connection cannot duplicate the record. */
      id?: string;
      damId: string;
      sireId?: string;
      breedingGroupId?: string;
      method: string;
      startDate: Date;
      endDate?: Date;
      notes?: string;
    },
    recordedBy: string,
  ) {
    const dam = await this.loadDam(farmId, input.damId);

    if (input.sireId) {
      const sire = await this.animals.findById(farmId, input.sireId);
      if (!sire) throw AppError.badRequest('That sire is not in this flock.');
      if (sire.sex !== 'male') throw AppError.badRequest('A sire must be male.');
    }

    const next = this.advance(this.currentStatus(dam), {
      type: 'mating',
      date: input.startDate,
      species: dam.species as Species,
    });

    const mating = await this.matings.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      damId: input.damId,
      sireId: input.sireId ?? null,
      breedingGroupId: input.breedingGroupId ?? null,
      method: input.method,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      expectedDueDate: expectedDueDate(input.startDate, dam.species as Species),
      // A group mating with no named ram cannot attribute paternity with confidence.
      sireUncertain: !input.sireId && Boolean(input.breedingGroupId),
      recordedBy,
      notes: input.notes ?? null,
    } as Partial<MatingDoc>);

    await this.persist(farmId, input.damId, { ...next, matingId: mating._id });
    return mating;
  }

  // ------------------------------------------------------- pregnancy check --

  async recordPregnancyCheck(
    farmId: string,
    input: {
      id?: string;
      damId: string;
      date: Date;
      method: string;
      result: 'pregnant' | 'open' | 'uncertain';
      fetusCount?: number;
    },
    recordedBy: string,
  ) {
    const dam = await this.loadDam(farmId, input.damId);
    const current = this.currentStatus(dam);

    if (!current.matingId) {
      throw AppError.conflict('There is no mating on record to check against.');
    }
    if (input.fetusCount != null && input.method !== 'ultrasound') {
      throw AppError.badRequest('Only an ultrasound can count foetuses.');
    }

    const next = this.advance(current, {
      type: 'pregnancyCheck',
      date: input.date,
      result: input.result,
    });

    const check = await this.checks.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      damId: input.damId,
      matingId: current.matingId,
      date: input.date,
      method: input.method,
      result: input.result,
      fetusCount: input.fetusCount ?? null,
      recordedBy,
    } as Partial<PregnancyCheckDoc>);

    await this.persist(farmId, input.damId, next);
    return check;
  }

  // ----------------------------------------------------------------- birth --

  /**
   * A lamb often arrives before anyone has a tag to hand. Refusing the record is how births go
   * unrecorded, so it gets a provisional tag derived from its dam's, replaced when actually tagged.
   */
  private async provisionalTag(farmId: string, damTag: string): Promise<string> {
    for (let n = 1; n <= 12; n += 1) {
      const candidate = `${damTag}-${n}`;
      if (!(await this.animals.findByTag(farmId, candidate))) return candidate;
    }
    throw AppError.conflict('Could not allocate a provisional tag for this lamb.');
  }

  async recordBirth(
    farmId: string,
    input: {
      id?: string;
      damId: string;
      date: Date;
      assisted?: boolean;
      difficulty?: number;
      mothering?: number;
      offspring: Array<{
        sex: string;
        birthWeightKg?: number;
        vigour?: number;
        outcome: string;
        tagNumber?: string;
      }>;
      notes?: string;
    },
    recordedBy: string,
  ) {
    const dam = await this.loadDam(farmId, input.damId);
    const current = this.currentStatus(dam);
    const next = this.advance(current, { type: 'birth', date: input.date });

    const mating = current.matingId ? await this.matings.findById(farmId, current.matingId) : null;
    const birthType =
      (['single', 'twin', 'triplet', 'quad'] as const)[input.offspring.length - 1] ?? 'quad';

    const recorded: OffspringRecord[] = [];
    for (const lamb of input.offspring) {
      let animalId: string | null = null;

      // Only a live lamb joins the flock. A stillbirth belongs on the birth record, not the roster.
      if (lamb.outcome === 'live') {
        const tagNumber = lamb.tagNumber ?? (await this.provisionalTag(farmId, dam.tagNumber));
        const created = await this.animals.register(farmId, {
          tagNumber,
          species: dam.species,
          sex: lamb.sex,
          dateOfBirth: input.date,
          dobIsEstimate: false,
          origin: 'born',
          damId: dam._id,
          sireId: mating?.sireId ?? null,
          breedId: dam.breedId ?? null,
          currentGroupId: dam.currentGroupId ?? null,
          ...(lamb.birthWeightKg ? { lastWeightKg: lamb.birthWeightKg } : {}),
        } as Partial<AnimalDoc> & { tagNumber: string });
        animalId = created._id;
      }

      recorded.push({
        animalId,
        sex: lamb.sex,
        birthWeightKg: lamb.birthWeightKg ?? null,
        vigour: lamb.vigour ?? null,
        outcome: lamb.outcome,
        tagNumber: lamb.tagNumber ?? null,
      });
    }

    const birth = await this.births.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      damId: input.damId,
      matingId: current.matingId ?? null,
      sireId: mating?.sireId ?? null,
      date: input.date,
      birthType,
      assisted: input.assisted ?? false,
      difficulty: input.difficulty ?? 1,
      mothering: input.mothering ?? null,
      offspring: recorded,
      recordedBy,
      notes: input.notes ?? null,
    } as Partial<BirthDoc>);

    // A dam with a live lamb is nursing; one that lost the whole litter is not.
    const finalState = recorded.some((o) => o.outcome === 'live')
      ? this.advance(next, { type: 'nursingStarted', date: input.date })
      : next;

    await this.persist(farmId, input.damId, finalState);
    return birth;
  }

  // --------------------------------------------------------------- weaning --

  async recordWeaning(
    farmId: string,
    input: { id?: string; damId: string; date: Date; weightsKg?: Record<string, number> },
    recordedBy: string,
  ) {
    const dam = await this.loadDam(farmId, input.damId);
    const next = this.advance(this.currentStatus(dam), { type: 'weaning', date: input.date });

    const lambs = await this.animals.offspring(farmId, input.damId);
    const born = lambs.filter(
      (lamb) => lamb.dateOfBirth && lamb.dateOfBirth.getTime() <= input.date.getTime(),
    );

    const weaning = await this.weanings.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      damId: input.damId,
      lambIds: born.map((l) => l._id),
      date: input.date,
      weightsKg: input.weightsKg ?? {},
      recordedBy,
    } as Partial<WeaningDoc>);

    // A weaning weight is a real weight; record it against the lamb as well.
    for (const [lambId, kg] of Object.entries(input.weightsKg ?? {})) {
      await this.animals.updateById(farmId, lambId, { $set: { lastWeightKg: kg } });
    }

    await this.persist(farmId, input.damId, next);
    return weaning;
  }

  // -------------------------------------------------------------- abortion --

  async recordAbortion(
    farmId: string,
    input: { id?: string; damId: string; date: Date; suspectedCause?: string },
    recordedBy: string,
  ) {
    const dam = await this.loadDam(farmId, input.damId);
    const current = this.currentStatus(dam);
    const next = this.advance(current, { type: 'abortion', date: input.date });

    const abortion = await this.abortions.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      damId: input.damId,
      matingId: current.matingId ?? null,
      date: input.date,
      suspectedCause: input.suspectedCause ?? null,
      recordedBy,
    } as Partial<AbortionDoc>);

    await this.persist(farmId, input.damId, next);
    return abortion;
  }

  // --------------------------------------------------------------- replay --

  /**
   * Rebuild a female's reproductive state by replaying her events in order.
   *
   * This is what makes offline sync safe. A device that has been away for weeks pushes events the
   * server has never seen, interleaved with ones it has; rather than trusting whatever `repro` the
   * client computed, the server derives it again from the full stream. A stale client therefore
   * cannot corrupt the state — the worst it can do is contribute an event.
   *
   * The replay is deliberately *total*. An event that cannot apply is skipped and counted rather
   * than thrown, because the purpose here is to arrive at the best state the evidence supports,
   * and refusing to finish would leave the animal with no state at all.
   */
  async recomputeRepro(
    farmId: string,
    damId: string,
  ): Promise<{ state: ReproState; skipped: number }> {
    const animal = await this.animals.findById(farmId, damId);
    if (!animal) throw AppError.notFound('Animal not found');
    if (animal.sex !== 'female') return { state: 'open', skipped: 0 };

    const species = animal.species as Species;
    const [matings, checks, births, weanings, abortions] = await Promise.all([
      this.matings.find(farmId, { damId } as never, { sort: { startDate: 1 } }),
      this.checks.find(farmId, { damId } as never, { sort: { date: 1 } }),
      this.births.find(farmId, { damId } as never, { sort: { date: 1 } }),
      this.weanings.find(farmId, { damId } as never, { sort: { date: 1 } }),
      this.abortions.find(farmId, { damId } as never, { sort: { date: 1 } }),
    ]);

    interface Step {
      at: Date;
      /** Orders events recorded on the same day: a birth precedes the nursing it starts. */
      rank: number;
      event: ReproEvent;
      matingId?: string;
    }

    const steps: Step[] = [
      ...matings.map((m) => ({
        at: m.startDate,
        rank: 0,
        event: { type: 'mating', date: m.startDate, species } as ReproEvent,
        matingId: m._id,
      })),
      ...checks.map((c) => ({
        at: c.date,
        rank: 1,
        event: {
          type: 'pregnancyCheck',
          date: c.date,
          result: c.result as 'pregnant' | 'open' | 'uncertain',
        } as ReproEvent,
      })),
      ...abortions.map((a) => ({
        at: a.date,
        rank: 2,
        event: { type: 'abortion', date: a.date } as ReproEvent,
      })),
      ...births.flatMap((b) => {
        const base: Step[] = [{ at: b.date, rank: 3, event: { type: 'birth', date: b.date } }];
        if (b.offspring.some((o) => o.outcome === 'live')) {
          base.push({ at: b.date, rank: 4, event: { type: 'nursingStarted', date: b.date } });
        }
        return base;
      }),
      ...weanings.map((w) => ({
        at: w.date,
        rank: 5,
        event: { type: 'weaning', date: w.date } as ReproEvent,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.rank - b.rank);

    let status: ReproStatus = { state: 'open', sinceDate: animal.createdAt };
    let skipped = 0;

    for (const step of steps) {
      try {
        status = applyReproEvent(status, step.event);
        if (step.matingId) status = { ...status, matingId: step.matingId };
      } catch {
        skipped += 1;
      }
    }

    await this.persist(farmId, damId, status);
    return { state: status.state, skipped };
  }

  // ---------------------------------------------------------------- alerts --

  /**
   * What needs doing, derived from state rather than stored as rows — so it is always in step with
   * the events, and can be recomputed identically on the device when offline (FR-ALT-05).
   */
  async alerts(farmId: string, today = new Date()) {
    const carrying = await this.animals.find(farmId, {
      sex: 'female',
      status: 'active',
      'repro.state': { $in: ['mated', 'pregnant', 'due'] },
    } as never);

    const dueSoon: Array<{ animalId: string; tagNumber: string; dueDate: string; days: number }> =
      [];
    const overdue: typeof dueSoon = [];

    for (const animal of carrying) {
      const due = animal.repro?.dueDate;
      if (!due) continue;
      const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
      const entry = {
        animalId: animal._id,
        tagNumber: animal.tagNumber,
        dueDate: due.toISOString().slice(0, 10),
        days,
      };
      if (days < 0) overdue.push(entry);
      else if (isInDueWindow(due, animal.species as Species, today)) dueSoon.push(entry);
    }

    const nursing = await this.animals.count(farmId, { 'repro.state': 'nursing' } as never);

    return {
      dueSoon: dueSoon.sort((a, b) => a.days - b.days),
      overdue: overdue.sort((a, b) => a.days - b.days),
      nursing,
    };
  }
}
