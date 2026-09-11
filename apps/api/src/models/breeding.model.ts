import { model, Schema } from 'mongoose';
import { REPRO_STATES } from '@nasl/shared';
import { tenantSchema, type TenantDocument } from './base.ts';

/**
 * Reproduction is recorded as immutable events. An animal's `repro` state is derived from them and
 * recomputed on write, never edited directly — which is what keeps a lifetime productivity record
 * honest and what will make offline sync tractable (scope §6, §10).
 */

// ---------------------------------------------------------------------------
// Mating
// ---------------------------------------------------------------------------

export const MATING_METHODS = ['natural', 'ai'] as const;

export interface MatingDoc extends TenantDocument {
  damId: string;
  sireId?: string | null;
  breedingGroupId?: string | null;
  method: string;
  startDate: Date;
  endDate?: Date | null;
  expectedDueDate: Date;
  /** Set when two rams ran with the group, so paternity cannot be attributed with confidence. */
  sireUncertain: boolean;
  recordedBy: string;
  notes?: string | null;
}

const matingSchema = tenantSchema<MatingDoc>({
  damId: { type: String, required: true },
  sireId: { type: String, default: null },
  breedingGroupId: { type: String, default: null },
  method: { type: String, enum: MATING_METHODS, required: true, default: 'natural' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, default: null },
  expectedDueDate: { type: Date, required: true },
  sireUncertain: { type: Boolean, default: false },
  recordedBy: { type: String, required: true },
  notes: { type: String, default: null },
});
matingSchema.index({ farmId: 1, damId: 1, startDate: -1 });
matingSchema.index({ farmId: 1, expectedDueDate: 1 });

export const Mating = model<MatingDoc>('Mating', matingSchema);

// ---------------------------------------------------------------------------
// Pregnancy check
// ---------------------------------------------------------------------------

export const CHECK_METHODS = ['ultrasound', 'palpation', 'observation'] as const;
export const CHECK_RESULTS = ['pregnant', 'open', 'uncertain'] as const;

export interface PregnancyCheckDoc extends TenantDocument {
  damId: string;
  matingId: string;
  date: Date;
  method: string;
  result: string;
  /** Only an ultrasound can count fetuses; it drives feeding and the drop-pen alert. */
  fetusCount?: number | null;
  recordedBy: string;
}

const checkSchema = tenantSchema<PregnancyCheckDoc>({
  damId: { type: String, required: true },
  matingId: { type: String, required: true },
  date: { type: Date, required: true },
  method: { type: String, enum: CHECK_METHODS, required: true },
  result: { type: String, enum: CHECK_RESULTS, required: true },
  fetusCount: { type: Number, default: null, min: 0, max: 6 },
  recordedBy: { type: String, required: true },
});
checkSchema.index({ farmId: 1, damId: 1, date: -1 });

export const PregnancyCheck = model<PregnancyCheckDoc>('PregnancyCheck', checkSchema);

// ---------------------------------------------------------------------------
// Birth
// ---------------------------------------------------------------------------

export const BIRTH_TYPES = ['single', 'twin', 'triplet', 'quad'] as const;
export const OFFSPRING_OUTCOMES = ['live', 'stillborn', 'died24h'] as const;

export interface OffspringRecord {
  animalId?: string | null;
  sex: string;
  birthWeightKg?: number | null;
  vigour?: number | null;
  outcome: string;
  tagNumber?: string | null;
}

export interface BirthDoc extends TenantDocument {
  damId: string;
  matingId?: string | null;
  sireId?: string | null;
  date: Date;
  birthType: string;
  assisted: boolean;
  /** 1 unassisted … 4 veterinary intervention. A culling signal on the dam. */
  difficulty: number;
  /** 1 poor … 5 excellent. */
  mothering?: number | null;
  offspring: OffspringRecord[];
  recordedBy: string;
  notes?: string | null;
}

const offspringSchema = new Schema<OffspringRecord>(
  {
    animalId: { type: String, default: null },
    sex: { type: String, enum: ['female', 'male'], required: true },
    birthWeightKg: { type: Number, default: null, min: 0, max: 30 },
    vigour: { type: Number, default: null, min: 1, max: 5 },
    outcome: { type: String, enum: OFFSPRING_OUTCOMES, required: true },
    tagNumber: { type: String, default: null },
  },
  { _id: false },
);

const birthSchema = tenantSchema<BirthDoc>({
  damId: { type: String, required: true },
  matingId: { type: String, default: null },
  sireId: { type: String, default: null },
  date: { type: Date, required: true },
  birthType: { type: String, enum: BIRTH_TYPES, required: true },
  assisted: { type: Boolean, default: false },
  difficulty: { type: Number, default: 1, min: 1, max: 4 },
  mothering: { type: Number, default: null, min: 1, max: 5 },
  offspring: { type: [offspringSchema], default: [] },
  recordedBy: { type: String, required: true },
  notes: { type: String, default: null },
});
birthSchema.index({ farmId: 1, damId: 1, date: -1 });
birthSchema.index({ farmId: 1, date: -1 });

export const Birth = model<BirthDoc>('Birth', birthSchema);

// ---------------------------------------------------------------------------
// Weaning
// ---------------------------------------------------------------------------

export interface WeaningDoc extends TenantDocument {
  damId: string;
  birthId?: string | null;
  lambIds: string[];
  date: Date;
  weightsKg: Record<string, number>;
  recordedBy: string;
}

const weaningSchema = tenantSchema<WeaningDoc>({
  damId: { type: String, required: true },
  birthId: { type: String, default: null },
  lambIds: { type: [String], default: [] },
  date: { type: Date, required: true },
  weightsKg: { type: Object, default: {} },
  recordedBy: { type: String, required: true },
});
weaningSchema.index({ farmId: 1, damId: 1, date: -1 });

export const Weaning = model<WeaningDoc>('Weaning', weaningSchema);

// ---------------------------------------------------------------------------
// Abortion
// ---------------------------------------------------------------------------

export interface AbortionDoc extends TenantDocument {
  damId: string;
  matingId?: string | null;
  date: Date;
  suspectedCause?: string | null;
  recordedBy: string;
}

const abortionSchema = tenantSchema<AbortionDoc>({
  damId: { type: String, required: true },
  matingId: { type: String, default: null },
  date: { type: Date, required: true },
  suspectedCause: { type: String, default: null },
  recordedBy: { type: String, required: true },
});
abortionSchema.index({ farmId: 1, damId: 1, date: -1 });

export const Abortion = model<AbortionDoc>('Abortion', abortionSchema);

export const REPRO_STATE_VALUES = REPRO_STATES;
