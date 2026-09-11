import { model, Schema } from 'mongoose';
import { idField } from './base.ts';

export const PRODUCT_KINDS = [
  'vaccine',
  'antibiotic',
  'anthelmintic',
  'analgesic',
  'mineral',
  'other',
] as const;

/**
 * The veterinary product library — global, curated by us, read-only to farm users.
 *
 * `withdrawalMeatDays` and `withdrawalMilkDays` come from manufacturer datasheets. A wrong value
 * here can put treated meat into the food chain, which is why farm users cannot edit it and why
 * every change is audited (FR-ADM-03).
 */
export interface VetProductDoc {
  _id: string;
  nameAr: string;
  nameEn: string;
  kind: string;
  activeIngredient?: string | null;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
  species: string[];
  manufacturer?: string | null;
  /** Where the withdrawal figures came from — a datasheet URL or reference. */
  source?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema(
  {
    _id: idField,
    nameAr: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    kind: { type: String, enum: PRODUCT_KINDS, required: true },
    activeIngredient: { type: String, default: null, trim: true },
    withdrawalMeatDays: { type: Number, required: true, min: 0, max: 365 },
    withdrawalMilkDays: { type: Number, required: true, min: 0, max: 365 },
    species: { type: [String], default: ['sheep', 'goat'] },
    manufacturer: { type: String, default: null, trim: true },
    source: { type: String, default: null, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false, _id: false },
);

schema.index({ nameEn: 1 });
schema.index({ isActive: 1, kind: 1 });

export const VetProduct = model<VetProductDoc>('VetProduct', schema);
