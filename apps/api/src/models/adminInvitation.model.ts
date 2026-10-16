import { model } from 'mongoose';
import { globalSchema } from './base.ts';

export interface AdminInvitationDoc {
  _id: string;
  email: string;
  tokenHash: string;
  invitedBy: string;
  kind: 'admin' | 'bootstrap';
  userId?: string;
  state: 'pending' | 'sent' | 'accepted' | 'revoked' | 'failed';
  locale: 'ar' | 'en';
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
}

const schema = globalSchema<AdminInvitationDoc>({
  email: { type: String, required: true, lowercase: true, trim: true },
  tokenHash: { type: String, required: true, select: false },
  invitedBy: { type: String, required: true },
  kind: { type: String, enum: ['admin', 'bootstrap'], default: 'admin' },
  userId: { type: String },
  state: {
    type: String,
    enum: ['pending', 'sent', 'accepted', 'revoked', 'failed'],
    default: 'pending',
  },
  locale: { type: String, enum: ['ar', 'en'], default: 'ar' },
  expiresAt: { type: Date, required: true },
  acceptedAt: { type: Date },
});
schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ email: 1, state: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AdminInvitation = model<AdminInvitationDoc>('AdminInvitation', schema);
