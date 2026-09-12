import type { Model, UpdateQuery } from 'mongoose';
import { AppError } from '../errors.ts';
import { Animal } from '../models/animal.model.ts';
import { Group } from '../models/group.model.ts';
import { Movement } from '../models/movement.model.ts';
import { HealthEvent } from '../models/health.model.ts';
import { Weight } from '../models/weight.model.ts';
import { FeedLog, Transaction } from '../models/finance.model.ts';
import { MilkCollection, MilkTestDay } from '../models/milk.model.ts';
import { Abortion, Birth, Mating, PregnancyCheck, Weaning } from '../models/breeding.model.ts';
import type { TenantDocument } from '../models/base.ts';
import { BreedingService } from './breeding.service.ts';

/**
 * The sync protocol (scope §10).
 *
 * Two rules do the heavy lifting:
 *
 *  1. **Most collections are append-only.** Two shepherds recording two treatments on the same ewe
 *     from two phones produce two documents, not a conflict. Only `animals` and `groups` carry
 *     mutable fields, and those resolve last-write-wins per field against the server clock.
 *  2. **Derived state is never trusted from the client.** After a push, every affected female's
 *     reproductive state is recomputed from her full event stream. A device that has been offline
 *     for weeks can contribute events; it cannot dictate conclusions.
 */

export type SyncMode = 'append-only' | 'mutable';

/**
 * Every syncable collection shares the tenant document shape, which is all this service needs to
 * know about them: an id, a farm, timestamps and a soft-delete marker.
 */
type SyncModel = Model<TenantDocument>;

interface Syncable {
  name: string;
  model: SyncModel;
  mode: SyncMode;
}

/** Fields the server owns. A client may not write them, whatever it sends. */
const SERVER_OWNED = new Set([
  'farmId',
  'createdAt',
  'updatedAt',
  'repro',
  'withholdMeatUntil',
  'withholdMilkUntil',
]);

const COLLECTIONS: readonly Syncable[] = [
  { name: 'animals', model: Animal as unknown as SyncModel, mode: 'mutable' },
  { name: 'groups', model: Group as unknown as SyncModel, mode: 'mutable' },
  { name: 'movements', model: Movement as unknown as SyncModel, mode: 'append-only' },
  { name: 'matings', model: Mating as unknown as SyncModel, mode: 'append-only' },
  { name: 'pregnancyChecks', model: PregnancyCheck as unknown as SyncModel, mode: 'append-only' },
  { name: 'births', model: Birth as unknown as SyncModel, mode: 'append-only' },
  { name: 'weanings', model: Weaning as unknown as SyncModel, mode: 'append-only' },
  { name: 'abortions', model: Abortion as unknown as SyncModel, mode: 'append-only' },
  { name: 'healthEvents', model: HealthEvent as unknown as SyncModel, mode: 'append-only' },
  { name: 'weights', model: Weight as unknown as SyncModel, mode: 'append-only' },
  { name: 'transactions', model: Transaction as unknown as SyncModel, mode: 'append-only' },
  { name: 'feedLogs', model: FeedLog as unknown as SyncModel, mode: 'append-only' },
  { name: 'milkTestDays', model: MilkTestDay as unknown as SyncModel, mode: 'append-only' },
  { name: 'milkCollections', model: MilkCollection as unknown as SyncModel, mode: 'append-only' },
];

export interface ChangeSet {
  created: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  deleted: string[];
}

export type Changes = Record<string, ChangeSet>;

export interface PushResult {
  applied: number;
  rejected: Array<{ collection: string; id: string; reason: string }>;
  recomputed: string[];
}

/** Collections whose writes can change a female's derived reproductive state. */
const REPRO_SOURCES = new Set(['matings', 'pregnancyChecks', 'births', 'weanings', 'abortions']);

export class SyncService {
  private readonly breeding = new BreedingService();

  /** Everything in this farm that changed at or after `since`. */
  async pull(
    farmId: string,
    since: Date,
    limit = 500,
  ): Promise<{ timestamp: Date; changes: Changes }> {
    // Taken before reading, so a document written mid-pull is picked up next time rather than
    // falling into the gap between the read and the cursor.
    const timestamp = new Date();
    const changes: Changes = {};

    for (const { name, model } of COLLECTIONS) {
      const docs = await model
        .find({ farmId, updatedAt: { $gte: since } })
        .sort({ updatedAt: 1 })
        .limit(limit)
        .lean<TenantDocument[]>()
        .exec();

      const set: ChangeSet = { created: [], updated: [], deleted: [] };
      for (const doc of docs) {
        if (doc.deletedAt) set.deleted.push(doc._id);
        else if (doc.createdAt >= since)
          set.created.push(doc as unknown as Record<string, unknown>);
        else set.updated.push(doc as unknown as Record<string, unknown>);
      }
      changes[name] = set;
    }

    return { timestamp, changes };
  }

  /**
   * Apply a device's change set.
   *
   * Nothing here throws on a single bad row: a device that has been offline for a fortnight may be
   * carrying hundreds of records, and rejecting the batch because one of them is malformed would
   * strand all of them. Bad rows come back named so the client can surface or drop them.
   */
  async push(farmId: string, changes: Changes): Promise<PushResult> {
    const rejected: PushResult['rejected'] = [];
    const touchedDams = new Set<string>();
    let applied = 0;

    for (const { name, model, mode } of COLLECTIONS) {
      const set = changes[name];
      if (!set) continue;

      for (const raw of [...(set.created ?? []), ...(set.updated ?? [])]) {
        const id = typeof raw._id === 'string' ? raw._id : null;
        if (!id) {
          rejected.push({ collection: name, id: '(missing)', reason: 'no id' });
          continue;
        }

        const payload: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw)) {
          if (key === '_id' || SERVER_OWNED.has(key)) continue;
          payload[key] = value;
        }

        try {
          if (mode === 'append-only') {
            // Idempotent: re-pushing an event the server already has is a no-op, which is what
            // makes a retry after a dropped connection safe.
            await model.updateOne(
              { _id: id, farmId },
              { $setOnInsert: { ...payload, _id: id, farmId } } as UpdateQuery<TenantDocument>,
              { upsert: true },
            );
          } else {
            await model.updateOne(
              { _id: id, farmId },
              { $set: payload } as UpdateQuery<TenantDocument>,
              { upsert: true },
            );
          }
          applied += 1;

          if (REPRO_SOURCES.has(name) && typeof raw.damId === 'string') touchedDams.add(raw.damId);
        } catch (err) {
          rejected.push({
            collection: name,
            id,
            reason: err instanceof Error ? err.message : 'write failed',
          });
        }
      }

      for (const id of set.deleted ?? []) {
        if (mode === 'append-only') {
          // An event is evidence of something that happened. It is not the client's to retract.
          rejected.push({ collection: name, id, reason: 'events cannot be deleted' });
          continue;
        }
        await model.updateOne({ _id: id, farmId }, { $set: { deletedAt: new Date() } });
        applied += 1;
      }
    }

    // Derive state from the events rather than believing whatever the device thought it was.
    const recomputed: string[] = [];
    for (const damId of touchedDams) {
      try {
        await this.breeding.recomputeRepro(farmId, damId);
        recomputed.push(damId);
      } catch {
        // The dam may not exist on this farm; the events were still recorded.
      }
    }

    return { applied, rejected, recomputed };
  }

  static assertKnownCollections(changes: Changes): void {
    const known = new Set(COLLECTIONS.map((c) => c.name));
    for (const name of Object.keys(changes)) {
      if (!known.has(name)) throw AppError.badRequest(`Unknown collection "${name}"`);
    }
  }

  static get collectionNames(): string[] {
    return COLLECTIONS.map((c) => c.name);
  }
}
