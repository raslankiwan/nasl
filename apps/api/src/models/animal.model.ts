import { model, Schema } from 'mongoose';
import {
  ANIMAL_CLASSES,
  ANIMAL_STATUSES,
  ORIGINS,
  REPRO_STATES,
  SEXES,
  SPECIES,
  type AnimalClass,
} from '@nasl/shared';
import { tenantSchema, type TenantDocument } from './base.ts';

export interface ReproSubdoc {
  state: string;
  sinceDate: Date;
  matingId?: string | null;
  dueDate?: Date | null;
}

export interface AnimalDoc extends TenantDocument {
  tagNumber: string;
  classification?: AnimalClass | null;
  classNumber?: number | null;
  classLabel?: string | null;
  activeClassLabel?: string | null;
  lifecycle: Array<{
    id: string;
    kind: string;
    from: string;
    to: string;
    date: Date;
    recordedBy: string;
    reason?: string;
    classLabel?: string;
  }>;
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
  classification: { type: String, enum: ANIMAL_CLASSES, default: null },
  classNumber: { type: Number, min: 1, default: null },
  classLabel: { type: String, default: null },
  activeClassLabel: { type: String, default: null },
  lifecycle: {
    type: [
      new Schema(
        {
          id: { type: String, required: true },
          kind: String,
          from: String,
          to: String,
          date: Date,
          recordedBy: String,
          reason: String,
          classLabel: String,
        },
        { _id: false },
      ),
    ],
    default: [],
  },
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
 * One tag number per farm, including archived ancestors, enforced by the database rather than by a read-then-write in
 * application code, which races (FR-REG-02). Historical numbers cannot be reassigned to another animal.
 */
schema.index({ farmId: 1, tagNumber: 1 }, { unique: true, name: 'farm_tag_never_reused' });
schema.index(
  { farmId: 1, activeClassLabel: 1 },
  {
    unique: true,
    partialFilterExpression: { activeClassLabel: { $type: 'string' } },
    name: 'farm_class_label_reserved',
  },
);

// The Today list and the due-to-lamb alerts.
schema.index({ farmId: 1, 'repro.state': 1, 'repro.dueDate': 1 });
// Pedigree traversal in both directions.
schema.index({ farmId: 1, damId: 1 });
schema.index({ farmId: 1, sireId: 1 });
// The default roster view.
schema.index({ farmId: 1, status: 1, tagNumber: 1 });

export const Animal = model<AnimalDoc>('Animal', schema);
