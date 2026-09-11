import { model } from 'mongoose';
import { tenantSchema, type TenantDocument } from './base.ts';

export const GROUP_TYPES = [
  'pen', // حظيرة
  'pasture', // مرعى
  'breeding', // مجموعة تلقيح
  'drop', // حظيرة الولادة
  'hospital', // حظيرة العزل
  'weaning', // مجموعة الفطام
  'fattening', // مجموعة التسمين
] as const;

export interface GroupDoc extends TenantDocument {
  name: string;
  type: string;
  capacity?: number | null;
  /** For a breeding group: the ram serving it, used to attribute paternity (FR-BR-02). */
  ramId?: string | null;
}

const schema = tenantSchema<GroupDoc>({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: GROUP_TYPES, required: true, default: 'pen' },
  capacity: { type: Number, default: null },
  ramId: { type: String, default: null },
});

schema.index(
  { farmId: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

export const Group = model<GroupDoc>('Group', schema);
