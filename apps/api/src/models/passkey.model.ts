import { model } from 'mongoose';
import { globalSchema } from './base.ts';

export interface PasskeyDoc {
  _id: string;
  userId: string;
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  rpId: string;
  transports: string[];
  name: string;
  createdAt: Date;
  lastUsedAt?: Date;
}
const schema = globalSchema<PasskeyDoc>({
  userId: { type: String, required: true, index: true },
  credentialId: { type: String, required: true, unique: true },
  publicKey: { type: Buffer, required: true },
  counter: { type: Number, required: true },
  rpId: { type: String, required: true },
  transports: { type: [String], default: [] },
  name: { type: String, required: true },
  lastUsedAt: { type: Date },
});
export const Passkey = model<PasskeyDoc>('Passkey', schema);

export interface PasskeyChallengeDoc {
  _id: string;
  challenge: string;
  purpose: 'register' | 'login';
  userId?: string;
  deviceId: string;
  origin: string;
  rpId: string;
  expiresAt: Date;
  name?: string;
}
const challengeSchema = globalSchema<PasskeyChallengeDoc>({
  challenge: { type: String, required: true },
  purpose: { type: String, required: true, enum: ['register', 'login'] },
  userId: { type: String },
  deviceId: { type: String, required: true },
  origin: { type: String, required: true },
  rpId: { type: String, required: true },
  name: { type: String },
  expiresAt: { type: Date, required: true },
});
challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasskeyChallenge = model<PasskeyChallengeDoc>('PasskeyChallenge', challengeSchema);
