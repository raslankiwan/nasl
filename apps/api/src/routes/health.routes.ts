import { Router } from 'express';
import { z } from 'zod';
import { HEALTH_EVENT_TYPES, ROUTES } from '@nasl/shared';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse, pathParam, userIdOf } from '../http/validate.ts';
import { HealthService } from '../services/health.service.ts';
import { VetProduct } from '../models/vetProduct.model.ts';
import type { HealthEventDoc } from '../models/health.model.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const today = () => new Date(new Date().toISOString().slice(0, 10));

const treatmentInput = z.object({
  id: z.string().uuid().optional(),
  animalIds: z.array(z.string().uuid()).min(1).max(500),
  date: isoDate,
  type: z.enum(HEALTH_EVENT_TYPES),
  productId: z.string().min(1).optional(),
  doseValue: z.number().min(0).max(1000).optional(),
  doseUnit: z.string().trim().max(16).optional(),
  route: z.enum(ROUTES).optional(),
  batchNo: z.string().trim().max(40).optional(),
  administeredBy: z.string().trim().min(1).max(80),
  cost: z.number().min(0).max(100_000).optional(),
  notes: z.string().trim().max(300).optional(),
});

function present(event: HealthEventDoc) {
  return {
    id: event._id,
    animalId: event.animalId,
    date: event.date.toISOString().slice(0, 10),
    type: event.type,
    productId: event.productId ?? null,
    productName: event.productName ?? null,
    doseValue: event.doseValue ?? null,
    doseUnit: event.doseUnit ?? null,
    route: event.route ?? null,
    batchNo: event.batchNo ?? null,
    administeredBy: event.administeredBy,
    cost: event.cost ?? null,
    withholdMeatUntil: event.withholdMeatUntil?.toISOString().slice(0, 10) ?? null,
    withholdMilkUntil: event.withholdMilkUntil?.toISOString().slice(0, 10) ?? null,
    notes: event.notes ?? null,
  };
}

export function healthRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const health = new HealthService();

  router.use(requireAuth(config.JWT_SECRET));

  /**
   * The product library, read-only to farm users. Curation is an admin act (FR-ADM-03) because a
   * wrong withdrawal period here is a food-safety failure, not a data-entry mistake.
   */
  router.get('/products', requireFarmAccess('health:read'), async (_req, res) => {
    const products = await VetProduct.find({ isActive: true }).sort({ nameEn: 1 }).lean().exec();
    res.set('cache-control', 'private, max-age=600');
    res.json({
      products: products.map((p) => ({
        id: p._id,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        kind: p.kind,
        activeIngredient: p.activeIngredient ?? null,
        withdrawalMeatDays: p.withdrawalMeatDays,
        withdrawalMilkDays: p.withdrawalMilkDays,
      })),
    });
  });

  router.post('/treatments', requireFarmAccess('health:write'), async (req, res) => {
    const { date, ...rest } = parse(treatmentInput, req.body);
    const result = await health.recordTreatment(
      farmIdOf(req),
      { ...rest, date: new Date(date) },
      userIdOf(req),
    );

    res.status(201).json({
      recorded: result.events.length,
      groupBatchId: result.groupBatchId,
      // Echoed so the client can warn immediately, without re-reading the animals.
      withdrawal: {
        meatUntil: result.withdrawal.meatUntil ?? null,
        milkUntil: result.withdrawal.milkUntil ?? null,
      },
      events: result.events.map(present),
    });
  });

  router.get('/animals/:animalId', requireFarmAccess('health:read'), async (req, res) => {
    const history = await health.historyFor(farmIdOf(req), pathParam(req, 'animalId'));
    res.json({ events: history.map(present) });
  });

  /** Who cannot be milked, and who cannot be sold (FR-HLT-04). */
  router.get('/withdrawal', requireFarmAccess('health:read'), async (req, res) => {
    res.json(await health.underWithdrawal(farmIdOf(req), today()));
  });

  return router;
}
