import { model } from 'mongoose';
import { globalSchema } from './base.ts';

/** Account/device preferences, not farm data. Farm access is rechecked on every dispatch. */
export interface PushSubscriptionDoc {
  _id: string;
  userId: string;
  endpointHash: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: 'ar' | 'en';
  leadDays: number;
  enabled: boolean;
  notifiedKeys: string[];
  leaseUntil: Date;
  lastCheckedAt: Date;
  lastTestAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
const schema = globalSchema<PushSubscriptionDoc>({
  userId: { type: String, required: true, index: true },
  endpointHash: { type: String, required: true, unique: true },
  endpoint: { type: String, required: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
  locale: { type: String, enum: ['ar', 'en'], default: 'ar' },
  leadDays: { type: Number, enum: [1, 3, 7], default: 3 },
  enabled: { type: Boolean, default: true },
  notifiedKeys: { type: [String], default: [] },
  leaseUntil: { type: Date, default: () => new Date(0) },
  lastCheckedAt: { type: Date, default: () => new Date(0) },
  lastTestAt: { type: Date, default: () => new Date(0) },
});
schema.index({ enabled: 1, lastCheckedAt: 1 });
export const PushSubscription = model<PushSubscriptionDoc>('PushSubscription', schema);
