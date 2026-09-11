import { model } from 'mongoose';
import { tenantSchema, type TenantDocument } from './base.ts';

/** An immutable record of an animal changing groups — traceability, and the compliance export. */
export interface MovementDoc extends TenantDocument {
  animalId: string;
  fromGroupId?: string | null;
  toGroupId?: string | null;
  date: Date;
  reason?: string | null;
  recordedBy: string;
}

const schema = tenantSchema<MovementDoc>({
  animalId: { type: String, required: true },
  fromGroupId: { type: String, default: null },
  toGroupId: { type: String, default: null },
  date: { type: Date, required: true },
  reason: { type: String, default: null, trim: true },
  recordedBy: { type: String, required: true },
});

schema.index({ farmId: 1, animalId: 1, date: -1 });

export const Movement = model<MovementDoc>('Movement', schema);
