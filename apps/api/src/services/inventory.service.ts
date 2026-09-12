import { daysBetween } from '@nasl/shared';
import { AppError } from '../errors.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';
import { InventoryItem, type InventoryItemDoc } from '../models/inventory.model.ts';
import { VetProduct } from '../models/vetProduct.model.ts';

/** A medicine expiring inside this window is worth warning about before it is wasted. */
const EXPIRING_SOON_DAYS = 60;
/** Below this fraction of the original quantity, a bottle is nearly gone. */
const LOW_STOCK_FRACTION = 0.2;

/**
 * The medicine cabinet (FR-HLT-05).
 *
 * Unlike the product library — which we curate, because a wrong withdrawal period is a food-safety
 * failure — the cabinet is the farm's own: what is on their shelf, in what batch, expiring when.
 */
export class InventoryService {
  private readonly items = new TenantRepository<InventoryItemDoc>(InventoryItem);

  /** Receive stock. The same batch arriving twice tops up rather than creating a second row. */
  async receive(
    farmId: string,
    input: {
      id?: string;
      productId: string;
      batchNo: string;
      expiry: Date;
      quantity: number;
      unit: string;
      unitCost?: number;
      supplier?: string;
    },
    recordedBy: string,
  ) {
    const product = await VetProduct.findById(input.productId).lean().exec();
    if (!product) throw AppError.badRequest('That product is not in the library.');

    const existing = await this.items.findOne(farmId, {
      productId: input.productId,
      batchNo: input.batchNo,
    } as never);

    if (existing) {
      const updated = await this.items.updateById(farmId, existing._id, {
        $inc: { qtyRemaining: input.quantity, qtyInitial: input.quantity },
        $set: { expiry: input.expiry },
      });
      return updated!;
    }

    return this.items.create(farmId, {
      ...(input.id ? { _id: input.id } : {}),
      productId: input.productId,
      productName: `${product.nameAr} / ${product.nameEn}`,
      batchNo: input.batchNo,
      expiry: input.expiry,
      qtyRemaining: input.quantity,
      qtyInitial: input.quantity,
      unit: input.unit,
      unitCost: input.unitCost ?? null,
      supplier: input.supplier ?? null,
      recordedBy,
    } as Partial<InventoryItemDoc>);
  }

  /**
   * Take a dose off the shelf when a treatment is recorded.
   *
   * Best effort by design: a herder who has not been keeping stock must still be able to record a
   * treatment. Running the shelf negative helps nobody, so it stops at zero, and a treatment is
   * never refused because the count was wrong.
   */
  async consume(
    farmId: string,
    productId: string,
    batchNo: string | null,
    quantity: number,
  ): Promise<void> {
    if (quantity <= 0) return;

    const filter = batchNo ? { productId, batchNo } : { productId };
    const item = await this.items.findOne(farmId, filter as never, {
      // Without a batch, use the one expiring soonest — the bottle you would actually reach for.
      sort: { expiry: 1 },
    });
    if (!item) return;

    await this.items.updateById(farmId, item._id, {
      $set: { qtyRemaining: Math.max(0, item.qtyRemaining - quantity) },
    });
  }

  async list(farmId: string, today = new Date()) {
    const items = await this.items.find(farmId, {}, { sort: { expiry: 1 }, limit: 200 });

    return items.map((item) => {
      const daysToExpiry = daysBetween(today, item.expiry);
      return {
        id: item._id,
        productId: item.productId,
        productName: item.productName,
        batchNo: item.batchNo,
        expiry: item.expiry.toISOString().slice(0, 10),
        daysToExpiry,
        qtyRemaining: item.qtyRemaining,
        qtyInitial: item.qtyInitial,
        unit: item.unit,
        supplier: item.supplier ?? null,
        expired: daysToExpiry < 0,
        expiringSoon: daysToExpiry >= 0 && daysToExpiry <= EXPIRING_SOON_DAYS,
        lowStock: item.qtyInitial > 0 && item.qtyRemaining / item.qtyInitial <= LOW_STOCK_FRACTION,
      };
    });
  }

  /** What needs attention on the shelf, for the Today list. */
  async warnings(farmId: string, today = new Date()) {
    const items = await this.list(farmId, today);
    return {
      expired: items.filter((i) => i.expired),
      expiringSoon: items.filter((i) => i.expiringSoon),
      lowStock: items.filter((i) => i.lowStock && !i.expired),
    };
  }

  async discard(farmId: string, itemId: string): Promise<void> {
    const removed = await this.items.softDelete(farmId, itemId);
    if (!removed) throw AppError.notFound('That item is not on this shelf.');
  }
}
