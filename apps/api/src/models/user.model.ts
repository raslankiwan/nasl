import { model } from 'mongoose';
import { LOCALES } from '@nasl/i18n';
import { globalSchema } from './base.ts';

/** A person. Global, not tenant-scoped — one person may work on several farms. */
export interface UserDoc {
  _id: string;
  /** E.164, e.g. +966501234567. The only identifier we ask for. */
  phone: string;
  name?: string;
  locale: string;
  defaultFarmId?: string;
  /** Our own staff. Grants access to the operator console, never to a farm's data by itself. */
  isPlatformAdmin: boolean;
  lastSeenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = globalSchema<UserDoc>({
  phone: { type: String, required: true, unique: true, index: true },
  name: { type: String, trim: true },
  locale: { type: String, enum: LOCALES, default: 'ar' },
  defaultFarmId: { type: String },
  isPlatformAdmin: { type: Boolean, default: false },
  lastSeenAt: { type: Date },
});

export const User = model<UserDoc>('User', schema);
