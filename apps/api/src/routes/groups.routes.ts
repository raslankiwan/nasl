import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { Group, GROUP_TYPES, type GroupDoc } from '../models/group.model.ts';
import { Movement, type MovementDoc } from '../models/movement.model.ts';
import { Animal } from '../models/animal.model.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse, pathParam, userIdOf } from '../http/validate.ts';

const groupInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(60),
  type: z.enum(GROUP_TYPES).default('pen'),
  capacity: z.number().int().positive().optional(),
  ramId: z.string().uuid().optional(),
});

const moveInput = z.object({
  animalIds: z.array(z.string().uuid()).min(1).max(500),
  toGroupId: z.string().uuid().nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  reason: z.string().trim().max(200).optional(),
});

function presentGroup(group: GroupDoc, headCount?: number) {
  return {
    id: group._id,
    name: group.name,
    type: group.type,
    capacity: group.capacity ?? null,
    ramId: group.ramId ?? null,
    ...(headCount === undefined ? {} : { headCount }),
  };
}

export function groupRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const groups = new TenantRepository<GroupDoc>(Group);
  const movements = new TenantRepository<MovementDoc>(Movement);
  const animals = new AnimalRepository();

  const assertRamIsOnFarm = async (farmId: string, ramId?: string) => {
    if (ramId && !(await animals.findById(farmId, ramId)))
      throw AppError.badRequest('That ram is not on this farm.');
  };

  router.use(requireAuth(config.JWT_SECRET));

  router.get('/', requireFarmAccess('animals:read'), async (req, res) => {
    const farmId = farmIdOf(req);
    const all = await groups.find(farmId, {}, { sort: { name: 1 } });

    // One aggregate rather than a count per group — a large farm has dozens of pens.
    const counts = await Animal.aggregate<{ _id: string; count: number }>([
      { $match: { farmId, deletedAt: null, status: 'active', currentGroupId: { $ne: null } } },
      { $group: { _id: '$currentGroupId', count: { $sum: 1 } } },
    ]).exec();
    const countFor = new Map(counts.map((c) => [c._id, c.count]));

    res.json({ groups: all.map((g) => presentGroup(g, countFor.get(g._id) ?? 0)) });
  });

  router.post('/', requireFarmAccess('animals:write'), async (req, res) => {
    const input = parse(groupInput, req.body);
    const { id, ...rest } = input;
    await assertRamIsOnFarm(farmIdOf(req), input.ramId);
    try {
      const created = await groups.create(farmIdOf(req), {
        ...rest,
        ...(id ? { _id: id } : {}),
      } as Partial<GroupDoc>);
      res.status(201).json(presentGroup(created, 0));
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw AppError.conflict(`A pen named "${input.name}" already exists.`, { field: 'name' });
      }
      throw err;
    }
  });

  router.patch('/:groupId', requireFarmAccess('animals:write'), async (req, res) => {
    const patch = parse(groupInput.partial().omit({ id: true }), req.body);
    await assertRamIsOnFarm(farmIdOf(req), patch.ramId);
    const updated = await groups.updateById(farmIdOf(req), pathParam(req, 'groupId'), {
      $set: patch,
    });
    if (!updated) throw AppError.notFound('Pen not found');
    res.json(presentGroup(updated));
  });

  router.delete('/:groupId', requireFarmAccess('animals:write'), async (req, res) => {
    const farmId = farmIdOf(req);
    const groupId = pathParam(req, 'groupId');

    const occupants = await animals.count(farmId, { currentGroupId: groupId });
    if (occupants > 0) {
      throw AppError.conflict(
        `This pen still holds ${occupants} head. Move them out before deleting it.`,
        { headCount: occupants },
      );
    }

    const removed = await groups.softDelete(farmId, groupId);
    if (!removed) throw AppError.notFound('Pen not found');
    res.status(204).end();
  });

  /**
   * Move animals between pens (FR-GRP-02). Each move writes an immutable movement record, so the
   * animal's location history survives for traceability and the compliance export.
   */
  router.post('/move', requireFarmAccess('animals:write'), async (req, res) => {
    const input = parse(moveInput, req.body);
    const farmId = farmIdOf(req);
    const recordedBy = userIdOf(req);
    const date = input.date ? new Date(input.date) : new Date();

    if (input.toGroupId) {
      const target = await groups.findById(farmId, input.toGroupId);
      if (!target) throw AppError.badRequest('That pen is not on this farm.');
    }

    const moved: string[] = [];
    for (const animalId of input.animalIds) {
      const animal = await animals.findById(farmId, animalId, {
        projection: { currentGroupId: 1 },
      });
      if (!animal) continue;
      if (animal.currentGroupId === input.toGroupId) continue;

      await movements.create(farmId, {
        animalId,
        fromGroupId: animal.currentGroupId ?? null,
        toGroupId: input.toGroupId,
        date,
        reason: input.reason ?? null,
        recordedBy,
      } as Partial<MovementDoc>);

      await animals.updateById(farmId, animalId, {
        $set: { currentGroupId: input.toGroupId },
      });
      moved.push(animalId);
    }

    res.status(201).json({ moved: moved.length, animalIds: moved });
  });

  return router;
}

export function movementRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const movements = new TenantRepository<MovementDoc>(Movement);

  router.use(requireAuth(config.JWT_SECRET));

  router.get('/:animalId/movements', requireFarmAccess('animals:read'), async (req, res) => {
    const history = await movements.find(
      farmIdOf(req),
      { animalId: pathParam(req, 'animalId') },
      { sort: { date: -1 }, limit: 100 },
    );
    res.json({
      movements: history.map((m) => ({
        id: m._id,
        fromGroupId: m.fromGroupId ?? null,
        toGroupId: m.toGroupId ?? null,
        date: m.date.toISOString().slice(0, 10),
        reason: m.reason ?? null,
      })),
    });
  });

  return router;
}
