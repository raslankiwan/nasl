import type { FilterQuery, Model, ProjectionType, SortOrder, UpdateQuery } from 'mongoose';
import type { TenantDocument } from '../models/base.ts';

/**
 * The tenancy boundary.
 *
 * MongoDB will happily return another farm's animals if one query forgets its `farmId`. Rather than
 * relying on every developer remembering, every read and write goes through this class, which takes
 * `farmId` as a required first argument and injects it into the filter itself (scope NFR-07).
 *
 * Three rules make it hold:
 *
 *  1. A caller-supplied `farmId` in a filter or payload is stripped, never trusted. Filters are
 *     often built from query parameters, so this is defence in depth rather than an assertion —
 *     it strips and warns instead of throwing, so hostile input cannot turn into a 500.
 *  2. `$where` is rejected outright. It executes arbitrary JavaScript server-side and can read
 *     documents the filter would otherwise exclude.
 *  3. `farmId` is `immutable` on the schema as well, so even a query that bypasses this class
 *     cannot move a document between farms.
 */

export interface FindOptions<TDoc> {
  sort?: { [K in keyof TDoc]?: SortOrder } | Record<string, SortOrder>;
  limit?: number;
  skip?: number;
  projection?: ProjectionType<TDoc>;
  /** Soft-deleted documents are excluded unless this is set. */
  includeDeleted?: boolean;
}

export interface RepositoryLogger {
  warn(obj: object, msg: string): void;
}

/** Keys that may never be set by a caller. */
const PROTECTED_KEYS = new Set(['farmId', '_id', 'createdAt', 'updatedAt']);
const UPDATE_OPERATORS = [
  '$set',
  '$setOnInsert',
  '$unset',
  '$rename',
  '$inc',
  '$push',
  '$addToSet',
];

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

export class TenantRepository<TDoc extends TenantDocument> {
  protected readonly model: Model<TDoc>;
  private readonly logger: RepositoryLogger | undefined;

  constructor(model: Model<TDoc>, logger?: RepositoryLogger) {
    this.model = model;
    this.logger = logger;
  }

  get collectionName(): string {
    return this.model.collection.collectionName;
  }

  // -------------------------------------------------------------------------
  // Scoping
  // -------------------------------------------------------------------------

  private sanitizeFilter(filter: FilterQuery<TDoc>): FilterQuery<TDoc> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter)) {
      if (key === '$where') {
        throw new TenantScopeError('$where is not permitted — it can bypass the tenant filter');
      }
      if (key === 'farmId') {
        this.warnStripped('filter', key);
        continue;
      }
      clean[key] = value;
    }
    return clean as FilterQuery<TDoc>;
  }

  /**
   * Build the final filter. `farmId` is applied last so it cannot be overwritten by anything the
   * caller passed, and `deletedAt` is applied only when the caller has not asked about it.
   */
  protected scope(
    farmId: string,
    filter: FilterQuery<TDoc> = {},
    includeDeleted = false,
  ): FilterQuery<TDoc> {
    if (!farmId) throw new TenantScopeError('farmId is required for every tenant-scoped query');
    const scoped = this.sanitizeFilter(filter) as Record<string, unknown>;
    if (!includeDeleted && !('deletedAt' in scoped)) scoped.deletedAt = null;
    scoped.farmId = farmId;
    return scoped as FilterQuery<TDoc>;
  }

  private stripProtected<T extends Record<string, unknown>>(payload: T, where: string): T {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (PROTECTED_KEYS.has(key)) {
        this.warnStripped(where, key);
        continue;
      }
      clean[key] = value;
    }
    return clean as T;
  }

  private sanitizeUpdate(update: UpdateQuery<TDoc>): UpdateQuery<TDoc> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(update)) {
      if (UPDATE_OPERATORS.includes(key) && value && typeof value === 'object') {
        clean[key] = this.stripProtected(value as Record<string, unknown>, `update.${key}`);
      } else if (key.startsWith('$')) {
        clean[key] = value;
      } else if (PROTECTED_KEYS.has(key)) {
        this.warnStripped('update', key);
      } else {
        clean[key] = value;
      }
    }
    return clean as UpdateQuery<TDoc>;
  }

  private warnStripped(where: string, key: string): void {
    this.logger?.warn(
      { collection: this.collectionName, where, key },
      'Stripped a protected key from a tenant-scoped query — the caller should not be setting this',
    );
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findById(farmId: string, id: string, options: FindOptions<TDoc> = {}) {
    return this.model
      .findOne(
        this.scope(farmId, { _id: id } as FilterQuery<TDoc>, options.includeDeleted),
        options.projection,
      )
      .lean<TDoc | null>()
      .exec();
  }

  async findOne(farmId: string, filter: FilterQuery<TDoc> = {}, options: FindOptions<TDoc> = {}) {
    return this.model
      .findOne(this.scope(farmId, filter, options.includeDeleted), options.projection)
      .sort(options.sort as never)
      .lean<TDoc | null>()
      .exec();
  }

  async find(farmId: string, filter: FilterQuery<TDoc> = {}, options: FindOptions<TDoc> = {}) {
    let query = this.model
      .find(this.scope(farmId, filter, options.includeDeleted), options.projection)
      .lean<TDoc[]>();
    if (options.sort) query = query.sort(options.sort as never);
    if (options.skip) query = query.skip(options.skip);
    if (options.limit) query = query.limit(options.limit);
    return query.exec();
  }

  async count(farmId: string, filter: FilterQuery<TDoc> = {}, options: FindOptions<TDoc> = {}) {
    return this.model.countDocuments(this.scope(farmId, filter, options.includeDeleted)).exec();
  }

  async exists(farmId: string, filter: FilterQuery<TDoc>): Promise<boolean> {
    return (await this.model.exists(this.scope(farmId, filter))) !== null;
  }

  /**
   * Everything in this farm that changed at or after `since` — the pull half of the sync protocol
   * (scope §10). Soft-deleted documents are included so the device can remove them locally.
   */
  async changedSince(farmId: string, since: Date, limit = 500) {
    return this.model
      .find(this.scope(farmId, { updatedAt: { $gte: since } } as FilterQuery<TDoc>, true))
      .sort({ updatedAt: 1 })
      .limit(limit)
      .lean<TDoc[]>()
      .exec();
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(farmId: string, data: Partial<TDoc> & { _id?: string }) {
    if (!farmId) throw new TenantScopeError('farmId is required to create a document');
    const { _id, ...rest } = data;
    const payload = this.stripProtected(rest as Record<string, unknown>, 'create');
    const created = await this.model.create({
      ...payload,
      ...(_id ? { _id } : {}),
      farmId,
    });
    return created.toObject() as TDoc;
  }

  async updateById(farmId: string, id: string, update: UpdateQuery<TDoc>) {
    return this.model
      .findOneAndUpdate(
        this.scope(farmId, { _id: id } as FilterQuery<TDoc>),
        this.sanitizeUpdate(update),
        { new: true, runValidators: true },
      )
      .lean<TDoc | null>()
      .exec();
  }

  async updateMany(farmId: string, filter: FilterQuery<TDoc>, update: UpdateQuery<TDoc>) {
    const result = await this.model
      .updateMany(this.scope(farmId, filter), this.sanitizeUpdate(update))
      .exec();
    return result.modifiedCount;
  }

  /** Soft delete. The record stays — it is an ancestor in someone's pedigree. */
  async softDelete(farmId: string, id: string) {
    return this.model
      .findOneAndUpdate(this.scope(farmId, { _id: id } as FilterQuery<TDoc>), {
        $set: { deletedAt: new Date() },
      })
      .lean<TDoc | null>()
      .exec();
  }

  async restore(farmId: string, id: string) {
    return this.model
      .findOneAndUpdate(
        this.scope(farmId, { _id: id } as FilterQuery<TDoc>, true),
        { $set: { deletedAt: null } },
        { new: true },
      )
      .lean<TDoc | null>()
      .exec();
  }

  /** Permanent removal. Only the retention purge job should call this. */
  async hardDelete(farmId: string, id: string): Promise<boolean> {
    const result = await this.model
      .deleteOne(this.scope(farmId, { _id: id } as FilterQuery<TDoc>, true))
      .exec();
    return result.deletedCount === 1;
  }
}
