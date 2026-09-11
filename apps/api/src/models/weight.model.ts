import { model } from 'mongoose';
import { tenantSchema, type TenantDocument } from './base.ts';

export const WEIGHT_METHODS = ['scale', 'tape', 'estimate'] as const;

/** A weighing. Immutable, like every other observation. */
export interface WeightDoc extends TenantDocument {
  animalId: string;
  date: Date;
  kg: number;
  method: string;
  /** Set when the weighing was taken as part of a weaning, so the two agree. */
  context?: string | null;
  recordedBy: string;
}

const schema = tenantSchema<WeightDoc>({
  animalId: { type: String, required: true },
  date: { type: Date, required: true },
  kg: { type: Number, required: true, min: 0, max: 200 },
  method: { type: String, enum: WEIGHT_METHODS, required: true, default: 'scale' },
  context: { type: String, default: null },
  recordedBy: { type: String, required: true },
});

schema.index({ farmId: 1, animalId: 1, date: -1 });
schema.index({ farmId: 1, date: -1 });

export const Weight = model<WeightDoc>('Weight', schema);
