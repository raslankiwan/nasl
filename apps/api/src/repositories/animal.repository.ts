import type { ClientSession, FilterQuery } from 'mongoose';
import { AnimalNumberRepository } from './animalNumber.repository.ts';
import { AppError } from '../errors.ts';
import { Animal, type AnimalDoc } from '../models/animal.model.ts';
import { TenantRepository, type RepositoryLogger } from './tenantRepository.ts';

export interface AnimalFilters {
  /** Matches the start of a tag number, or any part of a name. */
  q?: string;
  species?: string;
  sex?: string;
  status?: string;
  breedId?: string;
  groupId?: string;
  reproState?: string;
  /** Females only — the default view when working through the breeding flock. */
  breedingFemalesOnly?: boolean;
  underWithdrawal?: boolean;
  limit?: number;
  skip?: number;
}

export interface PedigreeNode {
  id: string;
  tagNumber: string;
  name: string | null;
  sex: string;
  breedId: string | null;
  dateOfBirth: string | null;
  dam: PedigreeNode | null;
  sire: PedigreeNode | null;
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class AnimalRepository extends TenantRepository<AnimalDoc> {
  constructor(logger?: RepositoryLogger, session?: ClientSession) {
    super(Animal, logger, session);
  }

  async findByTag(farmId: string, tagNumber: string) {
    return this.findOne(farmId, { tagNumber: tagNumber.trim() } as FilterQuery<AnimalDoc>, {
      includeDeleted: true,
    });
  }

  /**
   * Register an animal.
   *
   * Tag uniqueness is enforced by a unique index rather than a read-then-write, which races when
   * two shepherds add the same tag from two phones. The duplicate-key error is translated into the
   * conflicting animal so the app can show it (FR-REG-02).
   */
  async assertTagAvailable(farmId: string, tagNumber: string, selfId?: string) {
    const existing = await this.findByTag(farmId, tagNumber);
    if (existing && existing._id !== selfId)
      throw AppError.conflict(`Tag ${tagNumber} is already used by another animal.`, {
        field: 'tagNumber',
        conflictsWith: {
          id: existing._id,
          tagNumber: existing.tagNumber,
          name: existing.name ?? null,
        },
      });
  }

  private async numberSequence(farmId: string, tag?: string) {
    const sequence = new AnimalNumberRepository(this.session);
    if (!(await sequence.findOne(farmId))) {
      const all = await this.find(
        farmId,
        {},
        { includeDeleted: true, projection: { tagNumber: 1 } },
      );
      const highest = all.reduce(
        (max, animal) =>
          /^\d+$/.test(animal.tagNumber)
            ? Math.max(max, Math.min(Number(animal.tagNumber), Number.MAX_SAFE_INTEGER))
            : max,
        0,
      );
      await sequence.advanceTo(farmId, highest);
    }
    if (tag && /^\d+$/.test(tag))
      await sequence.advanceTo(farmId, Math.min(Number(tag), Number.MAX_SAFE_INTEGER));
    return sequence;
  }

  async reserveNumbers(farmId: string, tags: string[]) {
    for (const tag of tags) await this.numberSequence(farmId, tag);
  }

  async register(farmId: string, input: Partial<AnimalDoc>) {
    const tag = input.tagNumber?.trim();
    if (input._id) {
      const previous = await this.findById(farmId, input._id, { includeDeleted: true });
      if (previous) {
        if (
          (tag && tag !== previous.tagNumber) ||
          input.species !== previous.species ||
          input.sex !== previous.sex
        )
          throw AppError.conflict('This animal ID has already been assigned.');
        return previous;
      }
    }
    await this.assertParentageIsPossible(farmId, input);
    if (tag) await this.assertTagAvailable(farmId, tag);
    const sequence = await this.numberSequence(farmId, tag);
    for (let attempt = 0; attempt < 10; attempt++) {
      const tagNumber = tag ?? (await sequence.next(farmId));
      try {
        return await this.create(farmId, { ...input, tagNumber });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        if (this.session) throw error;
        if (input._id) {
          const previous = await this.findById(farmId, input._id, { includeDeleted: true });
          if (
            previous &&
            (!tag || tag === previous.tagNumber) &&
            input.species === previous.species &&
            input.sex === previous.sex
          )
            return previous;
        }
        if (tag) {
          await this.assertTagAvailable(farmId, tag);
          throw AppError.conflict('This animal ID has already been assigned.');
        }
      }
    }
    throw AppError.conflict('Could not allocate a unique animal number. Try again.');
  }

  async updateAnimal(farmId: string, id: string, patch: Partial<AnimalDoc>) {
    if (patch.tagNumber !== undefined) {
      patch = { ...patch, tagNumber: patch.tagNumber.trim() };
      await this.assertTagAvailable(farmId, patch.tagNumber!, id);
      await this.numberSequence(farmId, patch.tagNumber);
    }
    if (
      patch.damId !== undefined ||
      patch.sireId !== undefined ||
      patch.dateOfBirth !== undefined
    ) {
      const current = await this.findById(farmId, id);
      if (!current) throw AppError.notFound('Animal not found');
      await this.assertParentageIsPossible(farmId, { ...current, ...patch }, id);
    }

    try {
      const updated = await this.updateById(farmId, id, { $set: patch });
      if (!updated) throw AppError.notFound('Animal not found');
      return updated;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      throw AppError.conflict(`Tag ${patch.tagNumber} is already used by another animal.`, {
        field: 'tagNumber',
      });
    }
  }

  async list(farmId: string, filters: AnimalFilters = {}) {
    const filter: Record<string, unknown> = {};

    if (filters.q) {
      const pattern = escapeRegex(filters.q);
      filter.$or = [
        { tagNumber: { $regex: `^${pattern}`, $options: 'i' } },
        { name: { $regex: pattern, $options: 'i' } },
      ];
    }
    if (filters.species) filter.species = filters.species;
    if (filters.sex) filter.sex = filters.sex;
    if (filters.breedId) filter.breedId = filters.breedId;
    if (filters.groupId) filter.currentGroupId = filters.groupId;
    if (filters.reproState) filter['repro.state'] = filters.reproState;
    // Default to the working flock: a roster full of sold and dead animals is noise.
    filter.status = filters.status ?? 'active';
    if (filters.breedingFemalesOnly) filter.sex = 'female';
    if (filters.underWithdrawal) filter.withholdMeatUntil = { $gte: new Date() };

    const [items, total] = await Promise.all([
      this.find(farmId, filter as FilterQuery<AnimalDoc>, {
        sort: { tagNumber: 1 },
        limit: Math.min(filters.limit ?? 50, 200),
        skip: filters.skip ?? 0,
      }),
      this.count(farmId, filter as FilterQuery<AnimalDoc>),
    ]);

    return { items, total };
  }

  // -------------------------------------------------------------------------
  // Pedigree
  // -------------------------------------------------------------------------

  /**
   * Reject a parentage link that cannot be true (FR-PED-05):
   * a dam must be female, a sire male, a parent must predate its offspring, and no animal may be
   * its own ancestor. A pedigree with a cycle in it makes every downstream traversal non-terminating.
   */
  private async assertParentageIsPossible(
    farmId: string,
    candidate: Partial<AnimalDoc>,
    selfId?: string,
  ): Promise<void> {
    const checks: Array<[string | null | undefined, 'female' | 'male', string]> = [
      [candidate.damId, 'female', 'dam'],
      [candidate.sireId, 'male', 'sire'],
    ];

    for (const [parentId, requiredSex, label] of checks) {
      if (!parentId) continue;

      if (selfId && parentId === selfId) {
        throw AppError.badRequest(`An animal cannot be its own ${label}.`);
      }

      const parent = await this.findById(farmId, parentId);
      if (!parent) throw AppError.badRequest(`That ${label} is not in this flock.`);

      if (parent.sex !== requiredSex) {
        throw AppError.badRequest(
          label === 'dam' ? 'A dam must be female.' : 'A sire must be male.',
        );
      }

      if (parent.dateOfBirth && candidate.dateOfBirth) {
        if (parent.dateOfBirth.getTime() >= new Date(candidate.dateOfBirth).getTime()) {
          throw AppError.badRequest(`A ${label} must be born before its offspring.`);
        }
      }

      if (selfId && (await this.isDescendantOf(farmId, parentId, selfId))) {
        throw AppError.badRequest(
          `That ${label} is already descended from this animal — the pedigree would loop.`,
        );
      }
    }
  }

  /** Walk up from `startId` looking for `ancestorId`. Depth-capped so bad data cannot hang a request. */
  private async isDescendantOf(
    farmId: string,
    startId: string,
    ancestorId: string,
    maxDepth = 20,
  ): Promise<boolean> {
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || next.depth >= maxDepth || seen.has(next.id)) continue;
      seen.add(next.id);

      const animal = await this.findById(farmId, next.id, {
        projection: { damId: 1, sireId: 1 },
      });
      if (!animal) continue;

      for (const parentId of [animal.damId, animal.sireId]) {
        if (!parentId) continue;
        if (parentId === ancestorId) return true;
        queue.push({ id: parentId, depth: next.depth + 1 });
      }
    }
    return false;
  }

  /** Ancestor tree, `generations` levels deep (FR-PED-01). */
  async ancestors(farmId: string, id: string, generations = 4): Promise<PedigreeNode | null> {
    const build = async (animalId: string, depth: number): Promise<PedigreeNode | null> => {
      const animal = await this.findById(farmId, animalId, { includeDeleted: true });
      if (!animal) return null;

      const node: PedigreeNode = {
        id: animal._id,
        tagNumber: animal.tagNumber,
        name: animal.name ?? null,
        sex: animal.sex,
        breedId: animal.breedId ?? null,
        dateOfBirth: animal.dateOfBirth ? animal.dateOfBirth.toISOString().slice(0, 10) : null,
        dam: null,
        sire: null,
      };

      if (depth > 0) {
        const [dam, sire] = await Promise.all([
          animal.damId ? build(animal.damId, depth - 1) : null,
          animal.sireId ? build(animal.sireId, depth - 1) : null,
        ]);
        node.dam = dam;
        node.sire = sire;
      }
      return node;
    };

    return build(id, generations);
  }

  /** Direct offspring of a ewe or ram (FR-PED-02). */
  async offspring(farmId: string, id: string) {
    const animal = await this.findById(farmId, id, { projection: { sex: 1 } });
    if (!animal) throw AppError.notFound('Animal not found');
    const key = animal.sex === 'female' ? 'damId' : 'sireId';
    return this.find(farmId, { [key]: id } as FilterQuery<AnimalDoc>, {
      sort: { dateOfBirth: -1 },
      includeDeleted: true,
    });
  }
}
