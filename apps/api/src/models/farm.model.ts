import { model } from 'mongoose';
import { SPECIES } from '@nasl/shared';
import { globalSchema } from './base.ts';

/** A farm is the tenant root. It is not itself tenant-scoped. */
export interface FarmDoc {
  _id: string;
  name: string;
  ownerUserId: string;
  country: string;
  currency: string;
  timezone: string;
  species: string[];
  calendarPreference: 'hijri' | 'gregorian';
  /** Per-species gestation overrides. Defaults come from @nasl/shared. */
  gestationDays?: Record<string, number>;
  plan: 'free' | 'standard' | 'commercial';
  createdAt: Date;
  updatedAt: Date;
}

const schema = globalSchema<FarmDoc>({
  name: { type: String, required: true, trim: true },
  ownerUserId: { type: String, required: true, index: true },
  country: { type: String, required: true, default: 'SA' },
  currency: { type: String, required: true, default: 'SAR' },
  timezone: { type: String, required: true, default: 'Asia/Riyadh' },
  species: { type: [String], enum: SPECIES, default: ['sheep'] },
  calendarPreference: { type: String, enum: ['hijri', 'gregorian'], default: 'gregorian' },
  gestationDays: { type: Object },
  plan: { type: String, enum: ['free', 'standard', 'commercial'], default: 'free' },
});

export const Farm = model<FarmDoc>('Farm', schema);
