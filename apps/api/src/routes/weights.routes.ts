import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse, pathParam, userIdOf } from '../http/validate.ts';
import { WeightsService } from '../services/weights.service.ts';
import { WEIGHT_METHODS } from '../models/weight.model.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const single = z.object({
  id: z.string().uuid().optional(),
  animalId: z.string().uuid(),
  date: isoDate,
  kg: z.number().min(0.1).max(200),
  method: z.enum(WEIGHT_METHODS).default('scale'),
});

const session = z.object({
  date: isoDate,
  method: z.enum(WEIGHT_METHODS).default('scale'),
  weights: z
    .array(z.object({ animalId: z.string().uuid(), kg: z.number().min(0.1).max(200) }))
    .min(1)
    .max(500),
});

export function weightRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const weights = new WeightsService();

  router.use(requireAuth(config.JWT_SECRET));

  router.post('/', requireFarmAccess('animals:write'), async (req, res) => {
    const { date, ...rest } = parse(single, req.body);
    const weighing = await weights.record(
      farmIdOf(req),
      { ...rest, date: new Date(date) },
      userIdOf(req),
    );
    res.status(201).json({
      id: weighing._id,
      animalId: weighing.animalId,
      date: weighing.date.toISOString().slice(0, 10),
      kg: weighing.kg,
    });
  });

  /** A whole pen through the race in one go (FR-WGT-01). */
  router.post('/session', requireFarmAccess('animals:write'), async (req, res) => {
    const { date, ...rest } = parse(session, req.body);
    const recorded = await weights.recordMany(
      farmIdOf(req),
      { ...rest, date: new Date(date) },
      userIdOf(req),
    );
    res.status(201).json({ recorded: recorded.length });
  });

  router.get('/:animalId', requireFarmAccess('animals:read'), async (req, res) => {
    res.json(await weights.historyFor(farmIdOf(req), pathParam(req, 'animalId')));
  });

  return router;
}
