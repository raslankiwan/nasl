import { model } from 'mongoose';
import { globalSchema } from './base.ts';

export interface ImpersonationSessionDoc {
  _id: string;
  adminId: string;
  userId: string;
  reason: string;
  codeHash: string;
  codeExpiresAt: Date;
  expiresAt: Date;
  redeemedAt?: Date | null;
  revokedAt?: Date | null;
}
const schema = globalSchema<ImpersonationSessionDoc>({
  adminId: { type: String, required: true },
  userId: { type: String, required: true },
  reason: { type: String, required: true },
  codeHash: { type: String, required: true, unique: true },
  codeExpiresAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  redeemedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const ImpersonationSession = model<ImpersonationSessionDoc>('ImpersonationSession', schema);
