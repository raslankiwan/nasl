import { model, Schema } from 'mongoose';
import { idField } from './base.ts';

/**
 * An append-only record of every privileged action (FR-ADM-06). Nothing in the application ever
 * updates or deletes a row here; support answers "who changed this, and why" from this collection.
 */
export interface AuditLogDoc {
  _id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  createdAt: Date;
}

const schema = new Schema(
  {
    _id: idField,
    actorId: { type: String, required: true, index: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    reason: { type: String, default: null },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, _id: false },
);

schema.index({ targetType: 1, targetId: 1, createdAt: -1 });
schema.index({ createdAt: -1 });

export const AuditLog = model<AuditLogDoc>('AuditLog', schema);

export async function recordAudit(entry: Omit<AuditLogDoc, '_id' | 'createdAt'>): Promise<void> {
  await AuditLog.create(entry);
}
