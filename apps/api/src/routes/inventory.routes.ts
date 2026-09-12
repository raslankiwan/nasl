import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse, pathParam, userIdOf } from '../http/validate.ts';
import { InventoryService } from '../services/inventory.service.ts';
import { DOSE_UNITS } from '../models/inventory.model.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const today = () => new Date(new Date().toISOString().slice(0, 10));

const receiveInput = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().min(1),
  batchNo: z.string().trim().min(1).max(40),
  expiry: isoDate,
  quantity: z.number().min(0.1).max(100_000),
  unit: z.enum(DOSE_UNITS).default('ml'),
  unitCost: z.number().min(0).max(100_000).optional(),
  supplier: z.string().trim().max(120).optional(),
});

export function inventoryRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const inventory = new InventoryService();

  router.use(requireAuth(config.JWT_SECRET));

  router.get('/', requireFarmAccess('health:read'), async (req, res) => {
    res.json({ items: await inventory.list(farmIdOf(req), today()) });
  });

  router.get('/warnings', requireFarmAccess('health:read'), async (req, res) => {
    res.json(await inventory.warnings(farmIdOf(req), today()));
  });

  router.post('/', requireFarmAccess('health:write'), async (req, res) => {
    const { expiry, ...rest } = parse(receiveInput, req.body);
    const item = await inventory.receive(
      farmIdOf(req),
      { ...rest, expiry: new Date(expiry) },
      userIdOf(req),
    );
    res.status(201).json({
      id: item._id,
      productName: item.productName,
      batchNo: item.batchNo,
      qtyRemaining: item.qtyRemaining,
      unit: item.unit,
    });
  });

  router.delete('/:itemId', requireFarmAccess('health:write'), async (req, res) => {
    await inventory.discard(farmIdOf(req), pathParam(req, 'itemId'));
    res.status(204).end();
  });

  return router;
}
