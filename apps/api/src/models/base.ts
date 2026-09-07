import { randomUUID } from 'node:crypto';
import { Schema, type SchemaDefinition } from 'mongoose';

/**
 * Every document uses a string UUID as its `_id`, because IDs are minted on the device: a lamb
 * recorded with no signal already carries the identity its dam's birth record references
 * (scope §10). Nothing is renumbered at sync time.
 */
export const idField = { type: String, default: () => randomUUID() };

/** Fields every tenant-scoped document carries. */
export interface TenantDocument {
  _id: string;
  farmId: string;
  createdAt: Date;
  updatedAt: Date;
  /** Soft delete. Reads exclude these unless explicitly asked for. */
  deletedAt?: Date | null;
}

/**
 * Build a schema for a tenant-scoped collection.
 *
 * `farmId` is added here rather than by each caller so no collection can forget it, and it is
 * `immutable` so a document can never be moved between farms by an update — including one that
 * slips past the repository layer.
 */
export function tenantSchema<T>(definition: SchemaDefinition<T>): Schema {
  const schema = new Schema(
    {
      _id: idField,
      farmId: { type: String, required: true, index: true, immutable: true },
      deletedAt: { type: Date, default: null },
      ...definition,
    } as SchemaDefinition,
    { timestamps: true, versionKey: false, _id: false },
  );

  // The pull side of the sync protocol reads by farm and modification time (scope §9).
  schema.index({ farmId: 1, updatedAt: 1 });
  return schema;
}

/** Build a schema for a global (non-tenant) collection. */
export function globalSchema<T>(definition: SchemaDefinition<T>): Schema {
  return new Schema(
    { _id: idField, ...(definition as SchemaDefinition) },
    {
      timestamps: true,
      versionKey: false,
      _id: false,
    },
  );
}
