import { model } from 'mongoose';
import { tenantSchema, type TenantDocument } from './base.ts';

export const DOSE_UNITS = ['ml', 'g', 'dose', 'tablet'] as const;

/**
 * A bottle on the shelf (FR-HLT-05).
 *
 * Stock is per *batch*, not per product, because the batch number is what a treatment record has
 * to carry: a recall or a contamination investigation asks which animals got which batch, and a
 * per-product total cannot answer that.
 */
export interface InventoryItemDoc extends TenantDocument {
  productId: string;
  /** Denormalised so the shelf still reads correctly if a product is later retired. */
  productName: string;
  batchNo: string;
  expiry: Date;
  qtyRemaining: number;
  qtyInitial: number;
  unit: string;
  unitCost?: number | null;
  supplier?: string | null;
  recordedBy: string;
}

const schema = tenantSchema<InventoryItemDoc>({
  productId: { type: String, required: true },
  productName: { type: String, required: true },
  batchNo: { type: String, required: true, trim: true },
  expiry: { type: Date, required: true },
  qtyRemaining: { type: Number, required: true, min: 0 },
  qtyInitial: { type: Number, required: true, min: 0 },
  unit: { type: String, enum: DOSE_UNITS, required: true, default: 'ml' },
  unitCost: { type: Number, default: null, min: 0 },
  supplier: { type: String, default: null, trim: true },
  recordedBy: { type: String, required: true },
});

// One entry per batch of a product on a farm — receiving more of the same batch tops it up.
schema.index(
  { farmId: 1, productId: 1, batchNo: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
schema.index({ farmId: 1, expiry: 1 });

export const InventoryItem = model<InventoryItemDoc>('InventoryItem', schema);
