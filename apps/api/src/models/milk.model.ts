import { model } from 'mongoose';
import { tenantSchema, type TenantDocument } from './base.ts';

/**
 * A ewe's lactation — from lambing to drying off.
 *
 * Opened automatically when a birth is recorded, because a ewe that has lambed is in milk whether
 * or not anyone has weighed her yet, and asking a herder to declare it separately is a step that
 * will be skipped.
 */
export interface LactationDoc extends TenantDocument {
  animalId: string;
  birthId?: string | null;
  startDate: Date;
  /** Drying off. Null while she is still milking. */
  endDate?: Date | null;
  status: 'milking' | 'dried';
  recordedBy: string;
}

const lactationSchema = tenantSchema<LactationDoc>({
  animalId: { type: String, required: true },
  birthId: { type: String, default: null },
  startDate: { type: Date, required: true },
  endDate: { type: Date, default: null },
  status: { type: String, enum: ['milking', 'dried'], default: 'milking' },
  recordedBy: { type: String, required: true },
});

lactationSchema.index({ farmId: 1, animalId: 1, startDate: -1 });
lactationSchema.index({ farmId: 1, status: 1 });

export const Lactation = model<LactationDoc>('Lactation', lactationSchema);

/**
 * One ewe's measured yield on a test day.
 *
 * `kg` is the whole day — both milkings — because that is the unit every dairy-sheep scheme
 * estimates a lactation from, and halving or doubling at the point of entry is where mistakes get
 * made.
 */
export interface MilkTestDayDoc extends TenantDocument {
  lactationId: string;
  animalId: string;
  date: Date;
  kg: number;
  recordedBy: string;
}

const testDaySchema = tenantSchema<MilkTestDayDoc>({
  lactationId: { type: String, required: true },
  animalId: { type: String, required: true },
  date: { type: Date, required: true },
  kg: { type: Number, required: true, min: 0, max: 20 },
  recordedBy: { type: String, required: true },
});

// One measurement per ewe per test day: re-entering corrects rather than adds.
testDaySchema.index(
  { farmId: 1, animalId: 1, date: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
testDaySchema.index({ farmId: 1, lactationId: 1, date: 1 });

export const MilkTestDay = model<MilkTestDayDoc>('MilkTestDay', testDaySchema);

/** What actually went into the churn. The flock's income line, independent of per-ewe testing. */
export interface MilkCollectionDoc extends TenantDocument {
  date: Date;
  session: 'morning' | 'evening' | 'day';
  qtyKg: number;
  note?: string | null;
  recordedBy: string;
}

const collectionSchema = tenantSchema<MilkCollectionDoc>({
  date: { type: Date, required: true },
  session: { type: String, enum: ['morning', 'evening', 'day'], default: 'day' },
  qtyKg: { type: Number, required: true, min: 0, max: 100_000 },
  note: { type: String, default: null, trim: true },
  recordedBy: { type: String, required: true },
});

collectionSchema.index({ farmId: 1, date: -1 });

export const MilkCollection = model<MilkCollectionDoc>('MilkCollection', collectionSchema);
