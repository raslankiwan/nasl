import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ANIMAL_STATUSES,
  ANIMAL_CLASSES,
  ORIGINS,
  REPRO_STATES,
  SEXES,
  SPECIES,
  isUnderMeatWithdrawal,
} from '@nasl/shared';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { AnimalRepository } from '../repositories/animal.repository.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse, pathParam, userIdOf } from '../http/validate.ts';
import type { AnimalDoc } from '../models/animal.model.ts';

const isoDate = z.string().date('Use a valid YYYY-MM-DD date');

const animalInput = z.object({
  /** The device mints the id so an animal recorded offline keeps its identity (scope §10). */
  id: z.string().uuid().optional(),
  tagNumber: z.string().trim().min(1).max(32).optional(),
  classification: z.enum(ANIMAL_CLASSES).default('child'),
  eid: z.string().trim().max(64).optional(),
  name: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .transform((value) => value || null)
    .optional(),
  species: z.enum(SPECIES),
  breedId: z.string().trim().max(40).optional(),
  sex: z.enum(SEXES),
  dateOfBirth: isoDate
    .refine(
      (date) => date <= new Date().toISOString().slice(0, 10),
      'Birth cannot be in the future',
    )
    .optional(),
  dobIsEstimate: z.boolean().default(false),
  colour: z.string().trim().max(40).optional(),
  origin: z.enum(ORIGINS).default('born'),
  acquiredAt: isoDate.optional(),
  damId: z.string().uuid().optional(),
  sireId: z.string().uuid().optional(),
  currentGroupId: z.string().uuid().optional(),
});

const animalPatch = animalInput
  .partial()
  .omit({ id: true, tagNumber: true, classification: true })
  .strict();

const listQuery = z.object({
  q: z.string().trim().max(60).optional(),
  species: z.enum(SPECIES).optional(),
  sex: z.enum(SEXES).optional(),
  status: z.enum(ANIMAL_STATUSES).optional(),
  classification: z.enum(ANIMAL_CLASSES).optional(),
  breedId: z.string().optional(),
  groupId: z.string().optional(),
  reproState: z.enum(REPRO_STATES).optional(),
  breedingFemalesOnly: z.coerce.boolean().optional(),
  underWithdrawal: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

const statusChange = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(ANIMAL_STATUSES),
  date: isoDate.optional(),
  reason: z.string().trim().max(200).optional(),
});

/** Statuses that take the animal off the farm as food. */
const LEAVES_AS_FOOD = new Set(['sold', 'slaughtered']);

function toDoc(input: z.infer<typeof animalInput>): Partial<AnimalDoc> {
  // Old app versions may send a tag; only the server assigns the permanent farm number.
  const { id: _id, tagNumber: _tagNumber, dateOfBirth, acquiredAt, ...rest } = input;
  return {
    ...rest,
    ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
    ...(acquiredAt ? { acquiredAt: new Date(acquiredAt) } : {}),
  };
}

function present(animal: AnimalDoc) {
  return {
    id: animal._id,
    tagNumber: animal.tagNumber,
    classification: animal.classification ?? null,
    classLabel: animal.classLabel ?? null,
    lifecycle: animal.lifecycle ?? [],
    eid: animal.eid ?? null,
    name: animal.name ?? null,
    species: animal.species,
    breedId: animal.breedId ?? null,
    sex: animal.sex,
    dateOfBirth: animal.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    dobIsEstimate: animal.dobIsEstimate,
    colour: animal.colour ?? null,
    origin: animal.origin,
    damId: animal.damId ?? null,
    sireId: animal.sireId ?? null,
    currentGroupId: animal.currentGroupId ?? null,
    status: animal.status,
    repro: animal.repro
      ? {
          state: animal.repro.state,
          sinceDate: animal.repro.sinceDate.toISOString().slice(0, 10),
          dueDate: animal.repro.dueDate?.toISOString().slice(0, 10) ?? null,
        }
      : null,
    lastWeightKg: animal.lastWeightKg ?? null,
    withholdMeatUntil: animal.withholdMeatUntil?.toISOString().slice(0, 10) ?? null,
    withholdMilkUntil: animal.withholdMilkUntil?.toISOString().slice(0, 10) ?? null,
    updatedAt: animal.updatedAt.toISOString(),
  };
}

export function animalRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const animals = new AnimalRepository();

  router.use(requireAuth(config.JWT_SECRET));

  router.get('/', requireFarmAccess('animals:read'), async (req, res) => {
    const filters = parse(listQuery, req.query);
    const { items, total } = await animals.list(farmIdOf(req), filters);
    res.json({ animals: items.map(present), total });
  });

  router.post('/', requireFarmAccess('animals:write'), async (req, res) => {
    const input = parse(animalInput, req.body);
    const created = await animals.register(farmIdOf(req), {
      ...toDoc(input),
      ...(input.id ? { _id: input.id } : {}),
    });
    res.status(201).json(present(created));
  });

  /**
   * Bulk registration (FR-REG-03). One bad tag must not discard the rest of the pen, so each row
   * reports its own outcome and the request still succeeds.
   */
  router.post('/bulk', requireFarmAccess('animals:write'), async (req, res) => {
    const { animals: rows } = parse(
      z.object({ animals: z.array(animalInput).min(1).max(200) }),
      req.body,
    );
    const farmId = farmIdOf(req);

    const created: ReturnType<typeof present>[] = [];
    const failed: Array<{ tagNumber: string; code: string; message: string }> = [];

    for (const row of rows) {
      try {
        const animal = await animals.register(farmId, {
          ...toDoc(row),
          ...(row.id ? { _id: row.id } : {}),
        });
        created.push(present(animal));
      } catch (err) {
        if (err instanceof AppError) {
          failed.push({ tagNumber: row.tagNumber ?? '', code: err.code, message: err.message });
        } else {
          throw err;
        }
      }
    }

    res.status(created.length > 0 ? 201 : 409).json({ created, failed });
  });

  router.get('/:animalId', requireFarmAccess('animals:read'), async (req, res) => {
    const animal = await animals.findById(farmIdOf(req), pathParam(req, 'animalId'));
    if (!animal) throw AppError.notFound('Animal not found');
    res.json(present(animal));
  });

  router.patch('/:animalId', requireFarmAccess('animals:write'), async (req, res) => {
    const patch = parse(animalPatch, req.body);
    const updated = await animals.updateAnimal(farmIdOf(req), pathParam(req, 'animalId'), {
      ...(patch as Partial<AnimalDoc>),
      ...(patch.dateOfBirth ? { dateOfBirth: new Date(patch.dateOfBirth) } : {}),
      ...(patch.acquiredAt ? { acquiredAt: new Date(patch.acquiredAt) } : {}),
    });
    res.json(present(updated));
  });

  router.post('/:animalId/status', requireFarmAccess('animals:write'), async (req, res) => {
    const input = parse(statusChange, req.body);
    const { status } = input;
    const farmId = farmIdOf(req);
    const animalId = pathParam(req, 'animalId');

    const animal = await animals.findById(farmId, animalId);
    if (!animal) throw AppError.notFound('Animal not found');

    /**
     * A withdrawal period is a food-safety boundary, not a reminder (FR-HLT-03). It is enforced
     * here because this is the moment an animal would leave the farm as meat.
     */
    if (LEAVES_AS_FOOD.has(status)) {
      const withhold = { withholdMeatUntil: animal.withholdMeatUntil?.toISOString() ?? undefined };
      if (isUnderMeatWithdrawal(withhold, new Date())) {
        throw AppError.conflict(
          `This animal is under a withdrawal period until ${animal
            .withholdMeatUntil!.toISOString()
            .slice(0, 10)} and cannot leave the farm as meat.`,
          { field: 'status', withholdMeatUntil: animal.withholdMeatUntil },
        );
      }
    }

    const updated = await animals.changeStatus(
      farmId,
      animalId,
      {
        id: input.id ?? randomUUID(),
        status,
        date: input.date ? new Date(input.date) : new Date(),
        ...(input.reason ? { reason: input.reason } : {}),
      },
      userIdOf(req),
    );
    res.json(present(updated));
  });

  router.post('/:animalId/promote', requireFarmAccess('animals:write'), async (req, res) => {
    const input = parse(
      z
        .object({
          id: z.string().uuid(),
          classification: z.enum(['mother', 'male']),
          dateOfBirth: isoDate.optional(),
        })
        .strict(),
      req.body,
    );
    res.json(
      present(
        await animals.promote(
          farmIdOf(req),
          pathParam(req, 'animalId'),
          input.id,
          input.classification,
          userIdOf(req),
          input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
        ),
      ),
    );
  });

  router.delete('/:animalId', requireFarmAccess('animals:write'), async (req, res) => {
    const removed = await animals.softDelete(farmIdOf(req), pathParam(req, 'animalId'));
    if (!removed) throw AppError.notFound('Animal not found');
    res.status(204).end();
  });

  router.get('/:animalId/pedigree', requireFarmAccess('animals:read'), async (req, res) => {
    const { generations } = parse(
      z.object({ generations: z.coerce.number().int().min(1).max(6).default(4) }),
      req.query,
    );
    const tree = await animals.ancestors(farmIdOf(req), pathParam(req, 'animalId'), generations);
    if (!tree) throw AppError.notFound('Animal not found');
    res.json(tree);
  });

  router.get('/:animalId/offspring', requireFarmAccess('animals:read'), async (req, res) => {
    const children = await animals.offspring(farmIdOf(req), pathParam(req, 'animalId'));
    res.json({ offspring: children.map(present) });
  });

  return router;
}
