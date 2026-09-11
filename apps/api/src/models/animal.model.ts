import { model, Schema } from 'mongoose';
import { ANIMAL_STATUSES, ORIGINS, REPRO_STATES, SEXES, SPECIES } from '@nasl/shared';
import { tenantSchema, type TenantDocument } from './base.ts';

export interface ReproSubdoc {
  state: string;
  sinceDate: Date;
  matingId?: string | null;
  dueDate?: Date | null;
}

export interface AnimalDoc extends TenantDocument {
  tagNumber: string;
  eid?: string | null;
  name?: string | null;
  species: string;
  breedId?: string | null;
  sex: string;
  dateOfBirth?: Date | null;
  dobIsEstimate: boolean;
  colour?: string | null;
  origin: string;
  acquiredAt?: Date | null;
  damId?: string | null;
  sireId?: string | null;
  currentGroupId?: string | null;
  status: string;
  /** Derived from the event stream. Written only by the breeding service, never by a client. */
  repro?: ReproSubdoc | null;
  lastWeightKg?: number | null;
  withholdMeatUntil?: Date | null;
  withholdMilkUntil?: Date | null;
  photoKeys: string[];
}

const reproSchema = new Schema<ReproSubdoc>(
  {
    state: { type: String, enum: REPRO_STATES, required: true },
    sinceDate: { type: Date, required: true },
    matingId: { type: String, default: null },
    dueDate: { type: Date, default: null },
  },
  { _id: false },
);

const schema = tenantSchema<AnimalDoc>({
  tagNumber: { type: String, required: true, trim: true },
  eid: { type: String, default: null, trim: true },
  name: { type: String, default: null, trim: true },
  species: { type: String, enum: SPECIES, required: true },
  breedId: { type: String, default: null },
  sex: { type: String, enum: SEXES, required: true },
  dateOfBirth: { type: Date, default: null },
  dobIsEstimate: { type: Boolean, default: false },
  colour: { type: String, default: null, trim: true },
  origin: { type: String, enum: ORIGINS, required: true, default: 'born' },
  acquiredAt: { type: Date, default: null },
  damId: { type: String, default: null },
  sireId: { type: String, default: null },
  currentGroupId: { type: String, default: null },
  status: { type: String, enum: ANIMAL_STATUSES, default: 'active' },
  repro: { type: reproSchema, default: null },
  lastWeightKg: { type: Number, default: null },
  withholdMeatUntil: { type: Date, default: null },
  withholdMilkUntil: { type: Date, default: null },
  photoKeys: { type: [String], default: [] },
});

/**
 * One live tag number per farm, enforced by the database rather than by a read-then-write in
 * application code, which races (FR-REG-02). Partial, so a culled animal's tag can be reused.
 */
schema.index(
  { farmId: 1, tagNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

// The Today list and the due-to-lamb alerts.
schema.index({ farmId: 1, 'repro.state': 1, 'repro.dueDate': 1 });
// Pedigree traversal in both directions.
schema.index({ farmId: 1, damId: 1 });
schema.index({ farmId: 1, sireId: 1 });
// The default roster view.
schema.index({ farmId: 1, status: 1, tagNumber: 1 });

export const Animal = model<AnimalDoc>('Animal', schema);
