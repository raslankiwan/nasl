import { model } from 'mongoose';
import { tenantSchema, type TenantDocument } from './base.ts';

export const TRANSACTION_TYPES = ['sale', 'purchase', 'expense', 'income'] as const;

/**
 * Expense categories. Deliberately short: a herder will not maintain a chart of accounts, and a
 * list they will actually use beats a taxonomy they will not.
 */
export const EXPENSE_CATEGORIES = [
  'feed',
  'veterinary',
  'labour',
  'transport',
  'equipment',
  'other',
] as const;

export interface TransactionDoc extends TenantDocument {
  type: string;
  category?: string | null;
  amount: number;
  /** Copied from the farm at the time, so a later currency change does not rewrite history. */
  currency: string;
  date: Date;
  animalIds: string[];
  counterparty?: string | null;
  note?: string | null;
  paid: boolean;
  recordedBy: string;
}

const schema = tenantSchema<TransactionDoc>({
  type: { type: String, enum: TRANSACTION_TYPES, required: true },
  category: { type: String, enum: [...EXPENSE_CATEGORIES, null], default: null },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true },
  date: { type: Date, required: true },
  animalIds: { type: [String], default: [] },
  counterparty: { type: String, default: null, trim: true },
  note: { type: String, default: null, trim: true },
  paid: { type: Boolean, default: true },
  recordedBy: { type: String, required: true },
});

schema.index({ farmId: 1, date: -1 });
schema.index({ farmId: 1, type: 1, date: -1 });

export const Transaction = model<TransactionDoc>('Transaction', schema);

/** What a pen was fed. Quantities and cost — deliberately not nutrition. */
export interface FeedLogDoc extends TenantDocument {
  groupId?: string | null;
  date: Date;
  feedType: string;
  qtyKg: number;
  cost?: number | null;
  currency: string;
  recordedBy: string;
}

const feedSchema = tenantSchema<FeedLogDoc>({
  groupId: { type: String, default: null },
  date: { type: Date, required: true },
  feedType: { type: String, required: true, trim: true },
  qtyKg: { type: Number, required: true, min: 0 },
  cost: { type: Number, default: null, min: 0 },
  currency: { type: String, required: true },
  recordedBy: { type: String, required: true },
});

feedSchema.index({ farmId: 1, date: -1 });

export const FeedLog = model<FeedLogDoc>('FeedLog', feedSchema);
