import {
  defaultProtocolIds,
  dueProtocolTasks,
  PROTOCOL_DISCLAIMER,
  PROTOCOL_LIBRARY,
  protocolById,
  type ProtocolCompletion,
  type ProtocolSubject,
  type ProtocolTask,
} from '@nasl/shared';
import { AppError } from '../errors.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';
import { HealthEvent, type HealthEventDoc } from '../models/health.model.ts';
import { Farm } from '../models/farm.model.ts';

/**
 * The routine dose schedule (FR-HLT-07).
 *
 * Tasks are derived from the flock and the doses already recorded, never stored as rows. The
 * device does the same derivation against its local copy when there is no signal, so the two can
 * never disagree about whether a ewe is owed a booster.
 *
 * Nothing here decides *what* to give an animal. The library is a schedule with its sources
 * attached; the product, the dose and the timing are the veterinarian's, and the disclaimer
 * travels with every response saying so.
 */
export class ProtocolService {
  private readonly animals = new AnimalRepository();
  private readonly events = new TenantRepository<HealthEventDoc>(HealthEvent);

  /**
   * What this farm runs.
   *
   * A farm that predates the field has no `protocolIds` at all, and a lean read does not apply
   * schema defaults — so "never chose" would silently mean "no vaccinations scheduled" for every
   * farm that existed before this shipped. No choice recorded means the defaults. An empty array
   * is a choice, and is respected.
   */
  private async enabledFor(farmId: string): Promise<string[]> {
    const farm = await Farm.findById(farmId).select('protocolIds').lean().exec();
    if (!farm) throw AppError.notFound('That farm does not exist.');
    return farm.protocolIds ?? defaultProtocolIds();
  }

  /** The library, with each protocol marked on or off for this farm. */
  async settings(farmId: string) {
    const enabled = new Set(await this.enabledFor(farmId));

    return {
      disclaimer: PROTOCOL_DISCLAIMER,
      protocols: PROTOCOL_LIBRARY.map((protocol) => ({
        id: protocol.id,
        nameEn: protocol.nameEn,
        nameAr: protocol.nameAr,
        diseaseId: protocol.diseaseId ?? null,
        deliveredBy: protocol.deliveredBy,
        source: protocol.source,
        enabled: enabled.has(protocol.id),
        steps: protocol.steps.map((step) => ({
          id: step.id,
          nameEn: step.nameEn,
          nameAr: step.nameAr,
          trigger: step.trigger,
          offsetDays: step.offsetDays,
          noteEn: step.noteEn ?? null,
          noteAr: step.noteAr ?? null,
        })),
      })),
    };
  }

  /** Turn protocols on or off. Unknown ids are rejected rather than stored and silently ignored. */
  async setEnabled(farmId: string, protocolIds: string[]) {
    const unknown = protocolIds.filter((id) => !protocolById(id));
    if (unknown.length > 0) {
      throw AppError.badRequest(`No such protocol: ${unknown.join(', ')}`);
    }

    const farm = await Farm.findByIdAndUpdate(
      farmId,
      { $set: { protocolIds: [...new Set(protocolIds)] } },
      { new: true },
    )
      .select('protocolIds')
      .lean()
      .exec();
    if (!farm) throw AppError.notFound('That farm does not exist.');

    return { protocolIds: farm.protocolIds };
  }

  /**
   * Everything the flock is owed.
   *
   * Grouped by step rather than listed per animal: eighty separate lines saying "give the
   * pre-lambing booster" is a list nobody reads, while "24 ewes, booster due this week" is a job.
   */
  async tasks(farmId: string, today: Date, horizonDays = 30) {
    const enabled = await this.enabledFor(farmId);
    if (enabled.length === 0) {
      return { disclaimer: PROTOCOL_DISCLAIMER, groups: [], total: 0 };
    }

    const animals = await this.animals.find(farmId, { status: 'active' } as never, { limit: 5000 });
    const subjects: ProtocolSubject[] = animals.map((animal) => ({
      id: animal._id,
      tagNumber: animal.tagNumber,
      name: animal.name ?? null,
      sex: animal.sex,
      status: animal.status,
      dateOfBirth: animal.dateOfBirth ?? null,
      repro: animal.repro
        ? {
            state: animal.repro.state,
            dueDate: animal.repro.dueDate ?? null,
            sinceDate: animal.repro.sinceDate ?? null,
          }
        : null,
    }));

    const doses = await this.events.find(farmId, { protocolStepId: { $ne: null } } as never, {
      limit: 20_000,
      sort: { date: -1 },
    });
    const completions: ProtocolCompletion[] = doses.map((dose) => ({
      animalId: dose.animalId,
      stepId: dose.protocolStepId!,
      date: dose.date,
    }));

    const tasks = dueProtocolTasks(subjects, enabled, completions, today, horizonDays);
    return { disclaimer: PROTOCOL_DISCLAIMER, total: tasks.length, groups: groupByStep(tasks) };
  }
}

export interface TaskGroup {
  protocolId: string;
  stepId: string;
  nameEn: string;
  nameAr: string;
  noteEn: string | null;
  noteAr: string | null;
  deliveredBy: string;
  /** The earliest date in the group — what the farm should be looking at. */
  dueOn: string;
  overdue: number;
  due: number;
  upcoming: number;
  animals: Array<{ animalId: string; tagNumber: string; name: string | null; dueOn: string }>;
}

function groupByStep(tasks: readonly ProtocolTask[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();

  for (const task of tasks) {
    const group = groups.get(task.stepId) ?? {
      protocolId: task.protocolId,
      stepId: task.stepId,
      nameEn: task.nameEn,
      nameAr: task.nameAr,
      noteEn: task.noteEn,
      noteAr: task.noteAr,
      deliveredBy: task.deliveredBy,
      dueOn: task.dueOn,
      overdue: 0,
      due: 0,
      upcoming: 0,
      animals: [],
    };

    group[task.status] += 1;
    if (task.dueOn < group.dueOn) group.dueOn = task.dueOn;
    group.animals.push({
      animalId: task.animalId,
      tagNumber: task.tagNumber,
      name: task.name,
      dueOn: task.dueOn,
    });
    groups.set(task.stepId, group);
  }

  // Whatever is most overdue, and within that whatever affects most animals.
  return [...groups.values()].sort(
    (a, b) => a.dueOn.localeCompare(b.dueOn) || b.animals.length - a.animals.length,
  );
}
