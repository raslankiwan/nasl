import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse, pathParam, userIdOf } from '../http/validate.ts';
import { MilkService } from '../services/milk.service.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const today = () => new Date(new Date().toISOString().slice(0, 10));

const testDayInput = z.object({
  date: isoDate,
  entries: z
    .array(z.object({ animalId: z.string().uuid(), kg: z.number().min(0).max(20) }))
    .min(1)
    .max(500),
});

const collectionInput = z.object({
  id: z.string().uuid().optional(),
  date: isoDate,
  session: z.enum(['morning', 'evening', 'day']).default('day'),
  qtyKg: z.number().min(0).max(100_000),
  note: z.string().trim().max(200).optional(),
});

export function milkRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const milk = new MilkService();

  router.use(requireAuth(config.JWT_SECRET));

  /**
   * A test day for a group of ewes.
   *
   * The response names any ewe under a milk withdrawal. She is still recorded — the measurement is
   * real — but her milk must not reach the tank, and the parlour is where that needs saying.
   */
  router.post('/test-days', requireFarmAccess('animals:write'), async (req, res) => {
    const { date, entries } = parse(testDayInput, req.body);
    const result = await milk.recordTestDay(
      farmIdOf(req),
      { date: new Date(date), entries },
      userIdOf(req),
    );
    res.status(201).json(result);
  });

  router.post('/collections', requireFarmAccess('animals:write'), async (req, res) => {
    const { date, ...rest } = parse(collectionInput, req.body);
    const collection = await milk.recordCollection(
      farmIdOf(req),
      { ...rest, date: new Date(date) },
      userIdOf(req),
    );
    res.status(201).json({
      id: collection._id,
      date: collection.date.toISOString().slice(0, 10),
      qtyKg: collection.qtyKg,
    });
  });

  router.post('/dry-off/:animalId', requireFarmAccess('animals:write'), async (req, res) => {
    const { date } = parse(z.object({ date: isoDate.optional() }), req.body);
    const lactation = await milk.dryOff(
      farmIdOf(req),
      pathParam(req, 'animalId'),
      date ? new Date(date) : today(),
    );
    res.json({ id: lactation?._id, status: lactation?.status });
  });

  /** Every ewe currently milking, best first. */
  router.get('/milking', requireFarmAccess('animals:read'), async (req, res) => {
    res.json({ lactations: await milk.milkingFlock(farmIdOf(req), today()) });
  });

  router.get('/collections', requireFarmAccess('animals:read'), async (req, res) => {
    const { from, to } = parse(
      z.object({ from: isoDate.optional(), to: isoDate.optional() }),
      req.query,
    );
    const end = to ? new Date(to) : today();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
    res.json(await milk.collectionSummary(farmIdOf(req), start, end));
  });

  router.get('/animals/:animalId', requireFarmAccess('animals:read'), async (req, res) => {
    res.json({
      lactations: await milk.lactationsFor(farmIdOf(req), pathParam(req, 'animalId'), today()),
    });
  });

  return router;
}
