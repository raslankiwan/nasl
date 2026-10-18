import type { Model } from 'mongoose';
import { can, type Permission, type Role } from '@nasl/shared';
import { Animal } from '../models/animal.model.ts';
import { Group } from '../models/group.model.ts';
import { Movement } from '../models/movement.model.ts';
import { HealthEvent } from '../models/health.model.ts';
import { Weight } from '../models/weight.model.ts';
import { FeedLog, Transaction } from '../models/finance.model.ts';
import { MilkCollection, MilkTestDay } from '../models/milk.model.ts';
import { Abortion, Birth, Mating, PregnancyCheck, Weaning } from '../models/breeding.model.ts';
import type { TenantDocument } from '../models/base.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';

type SyncModel = Model<TenantDocument>;
const collection = (name: string, model: unknown, permission: Permission = 'animals:read') => ({
  name,
  repository: new TenantRepository(model as SyncModel),
  permission,
});
const COLLECTIONS = [
  collection('animals', Animal),
  collection('groups', Group),
  collection('movements', Movement),
  collection('matings', Mating),
  collection('pregnancyChecks', PregnancyCheck),
  collection('births', Birth),
  collection('weanings', Weaning),
  collection('abortions', Abortion),
  collection('healthEvents', HealthEvent, 'health:read'),
  collection('weights', Weight),
  collection('transactions', Transaction, 'finance:read'),
  collection('feedLogs', FeedLog, 'finance:read'),
  collection('milkTestDays', MilkTestDay),
  collection('milkCollections', MilkCollection),
];

export interface ChangeSet {
  created: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  deleted: string[];
}
export type Changes = Record<string, ChangeSet>;
export interface PullPage {
  until: string;
  /** null marks a completed collection; the tuple handles identical update timestamps. */
  after: Record<string, { at: string; id: string } | null>;
}

/** Bounded, tenant-scoped read sync. Writes use the same validated routes as online capture. */
export class SyncService {
  async pull(
    farmId: string,
    since: Date,
    limit = 500,
    role: Role = 'owner',
    page?: PullPage,
  ): Promise<{
    timestamp: Date;
    changes: Changes;
    nextPage: PullPage | null;
  }> {
    const until = page ? new Date(page.until) : new Date();
    const changes: Changes = {};
    const after: PullPage['after'] = {};
    let more = false;
    for (const { name, repository, permission } of COLLECTIONS) {
      if (!can(role, permission)) continue;
      if (page && page.after[name] === null) {
        after[name] = null;
        continue;
      }
      const cursor = page?.after[name];
      const docs = await repository.find(
        farmId,
        {
          updatedAt: { $gte: since, $lte: until },
          ...(cursor
            ? {
                $or: [
                  { updatedAt: { $gt: new Date(cursor.at) } },
                  { updatedAt: new Date(cursor.at), _id: { $gt: cursor.id } },
                ],
              }
            : {}),
        },
        { includeDeleted: true, sort: { updatedAt: 1, _id: 1 }, limit: limit + 1 },
      );
      const batch = docs.slice(0, limit);
      const last = batch.at(-1);
      after[name] =
        docs.length > limit && last ? { at: last.updatedAt.toISOString(), id: last._id } : null;
      more ||= after[name] !== null;
      const set: ChangeSet = { created: [], updated: [], deleted: [] };
      for (const doc of batch) {
        if (doc.deletedAt) set.deleted.push(doc._id);
        else if (doc.createdAt >= since)
          set.created.push(doc as unknown as Record<string, unknown>);
        else set.updated.push(doc as unknown as Record<string, unknown>);
      }
      changes[name] = set;
    }
    // Older clients must not advance past unread records. New clients follow nextPage and
    // commit the final timestamp only after every page has arrived.
    return {
      timestamp: more ? since : until,
      changes,
      nextPage: more ? { until: until.toISOString(), after } : null,
    };
  }

  static collectionsFor(role: Role): string[] {
    return COLLECTIONS.filter((c) => can(role, c.permission)).map((c) => c.name);
  }
}
