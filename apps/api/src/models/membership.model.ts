import { model, Schema } from 'mongoose';
import { ROLES } from '@nasl/shared';
import { idField } from './base.ts';

/**
 * Joins a user to a farm with a role. This is the record every authorisation check reads, so it is
 * deliberately its own collection rather than an array on either side.
 */
export interface MembershipDoc {
  _id: string;
  farmId: string;
  userId: string;
  role: string;
  invitedBy?: string;
  /** A visiting vet's access is time-limited (scope FR-ACC-02). */
  expiresAt?: Date | null;
  status: 'invited' | 'active' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema(
  {
    _id: idField,
    farmId: { type: String, required: true, immutable: true },
    userId: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    invitedBy: { type: String },
    expiresAt: { type: Date, default: null },
    status: { type: String, enum: ['invited', 'active', 'revoked'], default: 'active' },
  },
  { timestamps: true, versionKey: false, _id: false },
);

// One membership per person per farm.
schema.index({ farmId: 1, userId: 1 }, { unique: true });
schema.index({ userId: 1, status: 1 });

export const Membership = model<MembershipDoc>('Membership', schema);
