import { model, Schema } from 'mongoose';
import { idField } from './base.ts';

/** A pending phone verification. The code itself is never stored — only a salted hash. */
export interface OtpChallengeDoc {
  _id: string;
  phone: string;
  codeHash: string;
  salt: string;
  expiresAt: Date;
  attempts: number;
  consumedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema(
  {
    _id: idField,
    phone: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    salt: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, _id: false },
);

// Mongo removes spent challenges on its own; nothing accumulates.
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpChallenge = model<OtpChallengeDoc>('OtpChallenge', schema);
