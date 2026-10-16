import { model } from 'mongoose';
import { LOCALES } from '@nasl/i18n';
import { ACCOUNT_STATUSES, type AccountStatus } from '@nasl/shared';
import { globalSchema } from './base.ts';

/** A person. Global, not tenant-scoped — one person may work on several farms. */
export interface UserDoc {
  _id: string;
  email: string;
  username: string;
  passwordHash: string;
  status: AccountStatus;
  reviewedAt?: Date;
  reviewedBy?: string;
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
  email: { type: String, required: true, trim: true, lowercase: true },
  username: { type: String, required: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  status: { type: String, enum: ACCOUNT_STATUSES, default: 'pending' },
  reviewedAt: { type: Date },
  reviewedBy: { type: String },
  name: { type: String, trim: true },
  locale: { type: String, enum: LOCALES, default: 'ar' },
  defaultFarmId: { type: String },
  isPlatformAdmin: { type: Boolean, default: false },
  lastSeenAt: { type: Date },
});

// Preserve legacy records without identifiers during migration; new registrations require both.
schema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
schema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
);
schema.index({ status: 1, createdAt: -1 });

export const User = model<UserDoc>('User', schema);
