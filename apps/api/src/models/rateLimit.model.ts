import { model, Schema } from 'mongoose';

const schema = new Schema(
  {
    _id: { type: String, required: true },
    hits: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = model('RateLimit', schema);
