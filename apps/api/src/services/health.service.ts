import { randomUUID } from 'node:crypto';
import { mergeWithdrawal, withdrawalFor, type WithdrawalWindow } from '@nasl/shared';
import { AppError } from '../errors.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';
import { HealthEvent, type HealthEventDoc } from '../models/health.model.ts';
import { VetProduct } from '../models/vetProduct.model.ts';
import type { AnimalDoc } from '../models/animal.model.ts';

export interface TreatmentInput {
  animalIds: string[];
  date: Date;
  type: string;
  productId?: string;
  doseValue?: number;
  doseUnit?: string;
  route?: string;
  batchNo?: string;
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

  async recordTreatment(farmId: string, input: TreatmentInput, recordedBy: string) {
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
        administeredBy: input.administeredBy,
        cost: input.cost ?? null,
        withholdMeatUntil: window.meatUntil ? new Date(window.meatUntil) : null,
        withholdMilkUntil: window.milkUntil ? new Date(window.milkUntil) : null,
        notes: input.notes ?? null,
        recordedBy,
      } as Partial<HealthEventDoc>);

      created.push(event);
      await this.applyWithdrawal(farmId, animal, window);
    }

    if (created.length === 0) throw AppError.badRequest('None of those animals are in this flock.');
    return { events: created, groupBatchId, withdrawal: window };
  }

  /**
   * Widen the animal's restriction to cover this treatment. Never shorten it: a shorter period
   * from a later treatment does not cancel a longer one still running.
   */
  private async applyWithdrawal(
    farmId: string,
    animal: AnimalDoc,
    window: WithdrawalWindow,
  ): Promise<void> {
    if (!window.meatUntil && !window.milkUntil) return;

    const merged = mergeWithdrawal(
      {
        ...(animal.withholdMeatUntil
          ? { meatUntil: animal.withholdMeatUntil.toISOString().slice(0, 10) }
          : {}),
        ...(animal.withholdMilkUntil
          ? { milkUntil: animal.withholdMilkUntil.toISOString().slice(0, 10) }
          : {}),
      },
      window,
    );

    await this.animals.updateById(farmId, animal._id, {
      $set: {
        withholdMeatUntil: merged.meatUntil ? new Date(merged.meatUntil) : null,
        withholdMilkUntil: merged.milkUntil ? new Date(merged.milkUntil) : null,
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
