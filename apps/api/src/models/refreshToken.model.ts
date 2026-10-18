import { model, Schema } from 'mongoose';
import { idField } from './base.ts';

/**
 * One issued refresh token. Tokens rotate on every use: the presented token is revoked and a new
 * one issued in the same family. If a *revoked* token is ever presented again, the token has been
 * copied — the whole family is revoked and the user must sign in again.
 */
export interface RefreshTokenDoc {
  _id: string;
  userId: string;
  deviceId: string;
  /** SHA-256 of the token. The token itself exists only on the device. */
  tokenHash: string;
  /** All tokens descended from one sign-in share a family. */
  familyId: string;
  expiresAt: Date;
  sessionExpiresAt?: Date;
  revokedAt?: Date | null;
  replacedByTokenId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema(
  {
    _id: idField,
    userId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    sessionExpiresAt: { type: Date },
    revokedAt: { type: Date, default: null },
    replacedByTokenId: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, _id: false },
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenDoc>('RefreshToken', schema);
