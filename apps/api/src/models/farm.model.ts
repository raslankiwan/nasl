import { model } from 'mongoose';
import { defaultProtocolIds, SPECIES } from '@nasl/shared';
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
  /** Health protocols this farm runs. Ids from the curated library in @nasl/shared. */
  protocolIds: string[];
  plan: 'free' | 'standard' | 'commercial';
  createdAt: Date;
  updatedAt: Date;
}

const schema = globalSchema<FarmDoc>({
  name: { type: String, required: true, trim: true },
  ownerUserId: { type: String, required: true, index: true },
  // Launch market is Palestine. ILS is the everyday currency; JOD and USD also circulate, which
  // is why currency is per-farm rather than a constant.
  country: { type: String, required: true, default: 'PS' },
  currency: { type: String, required: true, default: 'ILS' },
  timezone: { type: String, required: true, default: 'Asia/Hebron' },
  species: { type: [String], enum: SPECIES, default: ['sheep'] },
  calendarPreference: { type: String, enum: ['hijri', 'gregorian'], default: 'gregorian' },
  gestationDays: { type: Object },
  // The endemic-region defaults. A farm can switch any of them off; routine worm dosing is not
  // among them, and has to be turned on deliberately.
  protocolIds: { type: [String], default: defaultProtocolIds },
  plan: { type: String, enum: ['free', 'standard', 'commercial'], default: 'free' },
});

export const Farm = model<FarmDoc>('Farm', schema);
