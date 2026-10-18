import { model } from 'mongoose';
import { globalSchema } from './base.ts';

interface EmailVerificationDoc {
  _id: string;
  userId: string;
  challengeId: string;
  codeHash: string;
  attempts: number;
  sentAt: Date;
  expiresAt: Date;
}
const schema = globalSchema<EmailVerificationDoc>({
  userId: { type: String, required: true, unique: true },
  challengeId: { type: String, required: true, unique: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  sentAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const EmailVerification = model<EmailVerificationDoc>('EmailVerification', schema);
