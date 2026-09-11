import { model } from 'mongoose';
import { HEALTH_EVENT_TYPES, ROUTES } from '@nasl/shared';
import { tenantSchema, type TenantDocument } from './base.ts';

/**
 * A treatment, vaccination, drench or examination.
 *
 * Immutable, like every other event. The withhold dates are copied onto the event at the moment
 * it is recorded rather than recomputed later: the product library is curated and can change, and
 * a treatment must always be judged by the withdrawal period that applied on the day it was given.
 */
export interface HealthEventDoc extends TenantDocument {
  animalId: string;
  /** Set when the event was applied to a whole pen, so the group can be shown or undone together. */
  groupBatchId?: string | null;
  date: Date;
  type: string;
  productId?: string | null;
  productName?: string | null;
  doseValue?: number | null;
  doseUnit?: string | null;
  route?: string | null;
  batchNo?: string | null;
  diagnosisId?: string | null;
  administeredBy: string;
  cost?: number | null;
  withholdMeatUntil?: Date | null;
  withholdMilkUntil?: Date | null;
  notes?: string | null;
  recordedBy: string;
}

const schema = tenantSchema<HealthEventDoc>({
  animalId: { type: String, required: true },
  groupBatchId: { type: String, default: null },
  date: { type: Date, required: true },
  type: { type: String, enum: HEALTH_EVENT_TYPES, required: true },
  productId: { type: String, default: null },
  // Denormalised so a treatment still reads correctly if a product is later retired.
  productName: { type: String, default: null },
  doseValue: { type: Number, default: null, min: 0 },
  doseUnit: { type: String, default: null },
  route: { type: String, enum: [...ROUTES, null], default: null },
  batchNo: { type: String, default: null },
  diagnosisId: { type: String, default: null },
  administeredBy: { type: String, required: true },
  cost: { type: Number, default: null, min: 0 },
  withholdMeatUntil: { type: Date, default: null },
  withholdMilkUntil: { type: Date, default: null },
  notes: { type: String, default: null },
  recordedBy: { type: String, required: true },
});

schema.index({ farmId: 1, animalId: 1, date: -1 });
schema.index({ farmId: 1, groupBatchId: 1 });
schema.index({ farmId: 1, date: -1 });

export const HealthEvent = model<HealthEventDoc>('HealthEvent', schema);
