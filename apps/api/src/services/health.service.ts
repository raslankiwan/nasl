import type { AnimalDoc } from '../models/animal.model.ts';
import { randomUUID } from 'node:crypto';
import { withdrawalFor, type WithdrawalWindow } from '@nasl/shared';
import { AppError } from '../errors.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';
import { HealthEvent, type HealthEventDoc } from '../models/health.model.ts';
import { VetProduct } from '../models/vetProduct.model.ts';
import { InventoryService } from './inventory.service.ts';

export interface TreatmentInput {
  /** Minted by the device. Only meaningful for a single-animal treatment. */
  id?: string;
  animalIds: string[];
  date: Date;
  type: string;
  productId?: string;
  doseValue?: number;
  doseUnit?: string;
  route?: string;
  batchNo?: string;
  /** Set when this dose was given against a scheduled protocol step, so the task closes. */
  protocolStepId?: string;
  administeredBy: string;
  cost?: number;
  notes?: string;
}

/**
 * Treatments and the withdrawal periods they impose.
 *
 * The withdrawal rule is the reason this service exists. A product's withholding periods come from
 * the curated library — never from the farm — and the resulting dates always *widen*: two
 * overlapping treatments leave the animal restricted until the later of the two, never the earlier.
 */
export class HealthService {
  private readonly animals = new AnimalRepository();
  private readonly events = new TenantRepository<HealthEventDoc>(HealthEvent);
  private readonly inventory = new InventoryService();

  async recordTreatment(farmId: string, input: TreatmentInput, recordedBy: string) {
    const previous =
      input.id && input.animalIds.length === 1
        ? await this.events.findById(farmId, input.id)
        : null;
    if (previous) {
      const withdrawal = {
        ...(previous.withholdMeatUntil
          ? { meatUntil: previous.withholdMeatUntil.toISOString().slice(0, 10) }
          : {}),
        ...(previous.withholdMilkUntil
          ? { milkUntil: previous.withholdMilkUntil.toISOString().slice(0, 10) }
          : {}),
      };
      // A retry also repairs a hold if the original process stopped after saving the event.
      await this.applyWithdrawal(farmId, previous.animalId, withdrawal);
      return { events: [previous], groupBatchId: previous.groupBatchId ?? null, withdrawal };
    }
    if (input.animalIds.length === 0) {
      throw AppError.badRequest('Choose at least one animal.');
    }

    const product = input.productId
      ? await VetProduct.findById(input.productId).lean().exec()
      : null;

    if (input.productId && !product) {
      throw AppError.badRequest('That product is not in the library.');
    }

    const window: WithdrawalWindow = product ? withdrawalFor(product, input.date) : {};

    // One id across the batch, so a pen treated together can be read — or undone — as one act.
    const groupBatchId = input.animalIds.length > 1 ? randomUUID() : null;

    const created: HealthEventDoc[] = [];
    for (const animalId of input.animalIds) {
      const animal = await this.animals.findById(farmId, animalId);
      if (!animal) continue;

      const event = await this.events.create(farmId, {
        // A batch mints its own ids; only a single-animal treatment can carry the client's.
        ...(input.id && input.animalIds.length === 1 ? { _id: input.id } : {}),
        animalId,
        groupBatchId,
        date: input.date,
        type: input.type,
        productId: product?._id ?? null,
        productName: product ? `${product.nameAr} / ${product.nameEn}` : null,
        doseValue: input.doseValue ?? null,
        doseUnit: input.doseUnit ?? null,
        route: input.route ?? null,
        batchNo: input.batchNo ?? null,
        protocolStepId: input.protocolStepId ?? null,
        administeredBy: input.administeredBy,
        cost: input.cost ?? null,
        withholdMeatUntil: window.meatUntil ? new Date(window.meatUntil) : null,
        withholdMilkUntil: window.milkUntil ? new Date(window.milkUntil) : null,
        notes: input.notes ?? null,
        recordedBy,
      } as Partial<HealthEventDoc>);

      created.push(event);
      await this.applyWithdrawal(farmId, animal._id, window);
    }

    if (created.length === 0) throw AppError.badRequest('None of those animals are in this flock.');

    // Take what was used off the shelf. Best effort: a herder who is not keeping stock must still
    // be able to record a treatment, so this never blocks the write (FR-HLT-05).
    if (product && input.doseValue) {
      await this.inventory.consume(
        farmId,
        product._id,
        input.batchNo ?? null,
        input.doseValue * created.length,
      );
    }

    return { events: created, groupBatchId, withdrawal: window };
  }

  /**
   * Widen the animal's restriction to cover this treatment. Never shorten it: a shorter period
   * from a later treatment does not cancel a longer one still running.
   */
  private async applyWithdrawal(
    farmId: string,
    animalId: string,
    window: WithdrawalWindow,
  ): Promise<void> {
    if (!window.meatUntil && !window.milkUntil) return;
    // MongoDB takes the maximum atomically. Merging an earlier read and then $setting it can
    // shorten a concurrent treatment's longer restriction.
    await this.animals.updateById(farmId, animalId, {
      $max: {
        ...(window.meatUntil ? { withholdMeatUntil: new Date(window.meatUntil) } : {}),
        ...(window.milkUntil ? { withholdMilkUntil: new Date(window.milkUntil) } : {}),
      },
    });
  }

  async historyFor(farmId: string, animalId: string, limit = 50) {
    return this.events.find(farmId, { animalId }, { sort: { date: -1 }, limit });
  }

  /**
   * Everything currently restricted, split by what it is restricted from.
   *
   * Milk and meat are listed separately because they are different questions asked at different
   * moments: milk is asked twice a day at milking, meat only on the day an animal leaves.
   */
  async underWithdrawal(farmId: string, today = new Date()) {
    const [meat, milk] = await Promise.all([
      this.animals.find(farmId, { withholdMeatUntil: { $gte: today } } as never, {
        sort: { withholdMeatUntil: 1 },
      }),
      this.animals.find(farmId, { withholdMilkUntil: { $gte: today } } as never, {
        sort: { withholdMilkUntil: 1 },
      }),
    ]);

    const present = (animal: AnimalDoc, until: Date | null | undefined) => ({
      animalId: animal._id,
      tagNumber: animal.tagNumber,
      classLabel: animal.classLabel ?? null,
      name: animal.name ?? null,
      until: until ? until.toISOString().slice(0, 10) : null,
      daysLeft: until ? Math.ceil((until.getTime() - today.getTime()) / 86_400_000) : 0,
    });

    return {
      meat: meat.map((a) => present(a, a.withholdMeatUntil)),
      milk: milk.map((a) => present(a, a.withholdMilkUntil)),
    };
  }
}
