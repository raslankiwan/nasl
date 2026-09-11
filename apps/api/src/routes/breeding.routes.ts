import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse, pathParam, userIdOf } from '../http/validate.ts';
import { BreedingService } from '../services/breeding.service.ts';
import { CHECK_METHODS, CHECK_RESULTS, MATING_METHODS } from '../models/breeding.model.ts';
import { Birth, Mating, PregnancyCheck } from '../models/breeding.model.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const today = () => new Date(new Date().toISOString().slice(0, 10));

const matingInput = z.object({
  id: z.string().uuid().optional(),
  damId: z.string().uuid(),
  sireId: z.string().uuid().optional(),
  breedingGroupId: z.string().uuid().optional(),
  method: z.enum(MATING_METHODS).default('natural'),
  startDate: isoDate,
  endDate: isoDate.optional(),
  notes: z.string().trim().max(300).optional(),
});

const checkInput = z.object({
  id: z.string().uuid().optional(),
  damId: z.string().uuid(),
  date: isoDate,
  method: z.enum(CHECK_METHODS),
  result: z.enum(CHECK_RESULTS),
  fetusCount: z.number().int().min(0).max(6).optional(),
});

const birthInput = z.object({
  id: z.string().uuid().optional(),
  damId: z.string().uuid(),
  date: isoDate,
  assisted: z.boolean().default(false),
  difficulty: z.number().int().min(1).max(4).default(1),
  mothering: z.number().int().min(1).max(5).optional(),
  offspring: z
    .array(
      z.object({
        sex: z.enum(['female', 'male']),
        birthWeightKg: z.number().min(0).max(30).optional(),
        vigour: z.number().int().min(1).max(5).optional(),
        outcome: z.enum(['live', 'stillborn', 'died24h']),
        tagNumber: z.string().trim().min(1).max(32).optional(),
      }),
    )
    .min(1)
    .max(6),
  notes: z.string().trim().max(300).optional(),
});

const weaningInput = z.object({
  id: z.string().uuid().optional(),
  damId: z.string().uuid(),
  date: isoDate,
  weightsKg: z.record(z.string().uuid(), z.number().min(0).max(150)).optional(),
});

const abortionInput = z.object({
  id: z.string().uuid().optional(),
  damId: z.string().uuid(),
  date: isoDate,
  suspectedCause: z.string().trim().max(200).optional(),
});

export function breedingRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const breeding = new BreedingService();

  router.use(requireAuth(config.JWT_SECRET));

  router.post('/matings', requireFarmAccess('breeding:write'), async (req, res) => {
    const { startDate, endDate, ...rest } = parse(matingInput, req.body);
    const mating = await breeding.recordMating(
      farmIdOf(req),
      {
        ...rest,
        startDate: new Date(startDate),
        ...(endDate ? { endDate: new Date(endDate) } : {}),
      },
      userIdOf(req),
    );
    res.status(201).json({
      id: mating._id,
      damId: mating.damId,
      sireId: mating.sireId ?? null,
      expectedDueDate: mating.expectedDueDate.toISOString().slice(0, 10),
      sireUncertain: mating.sireUncertain,
    });
  });

  router.post('/pregnancy-checks', requireFarmAccess('breeding:write'), async (req, res) => {
    const input = parse(checkInput, req.body);
    const check = await breeding.recordPregnancyCheck(
      farmIdOf(req),
      { ...input, date: new Date(input.date) },
      userIdOf(req),
    );
    res.status(201).json({
      id: check._id,
      damId: check.damId,
      result: check.result,
      fetusCount: check.fetusCount ?? null,
    });
  });

  router.post('/births', requireFarmAccess('breeding:write'), async (req, res) => {
    const input = parse(birthInput, req.body);
    const birth = await breeding.recordBirth(
      farmIdOf(req),
      { ...input, date: new Date(input.date) },
      userIdOf(req),
    );
    res.status(201).json({
      id: birth._id,
      damId: birth.damId,
      birthType: birth.birthType,
      date: birth.date.toISOString().slice(0, 10),
      offspring: birth.offspring.map((o) => ({
        animalId: o.animalId ?? null,
        sex: o.sex,
        outcome: o.outcome,
        birthWeightKg: o.birthWeightKg ?? null,
      })),
    });
  });

  router.post('/weanings', requireFarmAccess('breeding:write'), async (req, res) => {
    const input = parse(weaningInput, req.body);
    const weaning = await breeding.recordWeaning(
      farmIdOf(req),
      { ...input, date: new Date(input.date) },
      userIdOf(req),
    );
    res.status(201).json({ id: weaning._id, damId: weaning.damId, lambIds: weaning.lambIds });
  });

  router.post('/abortions', requireFarmAccess('breeding:write'), async (req, res) => {
    const input = parse(abortionInput, req.body);
    const abortion = await breeding.recordAbortion(
      farmIdOf(req),
      { ...input, date: new Date(input.date) },
      userIdOf(req),
    );
    res.status(201).json({ id: abortion._id, damId: abortion.damId });
  });

  /** The Today list: what needs doing, derived from state (FR-ALT-01, 02). */
  router.get('/alerts', requireFarmAccess('animals:read'), async (req, res) => {
    res.json(await breeding.alerts(farmIdOf(req), today()));
  });

  /** One female's full reproductive history, newest first. */
  router.get('/history/:damId', requireFarmAccess('animals:read'), async (req, res) => {
    const farmId = farmIdOf(req);
    const damId = pathParam(req, 'damId');

    const [matings, checks, births] = await Promise.all([
      Mating.find({ farmId, damId, deletedAt: null }).sort({ startDate: -1 }).lean().exec(),
      PregnancyCheck.find({ farmId, damId, deletedAt: null }).sort({ date: -1 }).lean().exec(),
      Birth.find({ farmId, damId, deletedAt: null }).sort({ date: -1 }).lean().exec(),
    ]);

    res.json({
      matings: matings.map((m) => ({
        id: m._id,
        sireId: m.sireId ?? null,
        startDate: m.startDate.toISOString().slice(0, 10),
        expectedDueDate: m.expectedDueDate.toISOString().slice(0, 10),
      })),
      pregnancyChecks: checks.map((c) => ({
        id: c._id,
        date: c.date.toISOString().slice(0, 10),
        method: c.method,
        result: c.result,
        fetusCount: c.fetusCount ?? null,
      })),
      births: births.map((b) => ({
        id: b._id,
        date: b.date.toISOString().slice(0, 10),
        birthType: b.birthType,
        assisted: b.assisted,
        difficulty: b.difficulty,
        born: b.offspring.length,
        live: b.offspring.filter((o) => o.outcome === 'live').length,
      })),
    });
  });

  return router;
}
