import { Router } from 'express';
import { z } from 'zod';
import { ANIMAL_CLASSES, SEXES, SPECIES } from '@nasl/shared';
import type { Config } from '../config.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { farmIdOf, parse, userIdOf } from '../http/validate.ts';
import { FinanceService } from '../services/finance.service.ts';
import { EXPENSE_CATEGORIES } from '../models/finance.model.ts';

const isoDate = z.string().date('Use a valid YYYY-MM-DD date');
const money = z.number().min(0).max(10_000_000);
const today = () => new Date(new Date().toISOString().slice(0, 10));

const saleInput = z.object({
  id: z.string().uuid().optional(),
  animalIds: z.array(z.string().uuid()).min(1).max(500),
  amount: money,
  date: isoDate,
  counterparty: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
  paid: z.boolean().default(true),
});

const purchaseInput = z.object({
  id: z.string().uuid().optional(),
  amount: money,
  date: isoDate,
  counterparty: z.string().trim().max(120).optional(),
  animals: z
    .array(
      z.object({
        tagNumber: z.string().trim().max(32).optional(),
        classification: z.enum(ANIMAL_CLASSES).default('child'),
        dateOfBirth: isoDate.optional(),
        species: z.enum(SPECIES),
        sex: z.enum(SEXES),
        breedId: z.string().trim().max(40).optional(),
      }),
    )
    .min(1)
    .max(200),
});

const expenseInput = z.object({
  id: z.string().uuid().optional(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: money,
  date: isoDate,
  note: z.string().trim().max(300).optional(),
});

const feedInput = z.object({
  id: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  date: isoDate,
  feedType: z.string().trim().min(1).max(60),
  qtyKg: z.number().min(0).max(100_000),
  cost: money.optional(),
});

export function financeRoutes(config: Config): Router {
  const router = Router({ mergeParams: true });
  const finance = new FinanceService(config.NODE_ENV === 'production');

  router.use(requireAuth(config.JWT_SECRET));

  router.post('/sales', requireFarmAccess('finance:write'), async (req, res) => {
    const { date, ...rest } = parse(saleInput, req.body);
    const sale = await finance.recordSale(
      farmIdOf(req),
      { ...rest, date: new Date(date) },
      userIdOf(req),
    );
    res.status(201).json({
      id: sale._id,
      amount: sale.amount,
      currency: sale.currency,
      animalsSold: sale.animalIds.length,
    });
  });

  router.post('/purchases', requireFarmAccess('finance:write'), async (req, res) => {
    const { date, ...rest } = parse(purchaseInput, req.body);
    const result = await finance.recordPurchase(
      farmIdOf(req),
      { ...rest, date: new Date(date) },
      userIdOf(req),
    );
    res.status(201).json({
      id: result.transaction._id,
      amount: result.transaction.amount,
      animalIds: result.animalIds,
    });
  });

  router.post('/expenses', requireFarmAccess('finance:write'), async (req, res) => {
    const { date, ...rest } = parse(expenseInput, req.body);
    const expense = await finance.recordExpense(
      farmIdOf(req),
      { ...rest, date: new Date(date) },
      userIdOf(req),
    );
    res.status(201).json({ id: expense._id, category: expense.category, amount: expense.amount });
  });

  router.post('/feed', requireFarmAccess('finance:write'), async (req, res) => {
    const { date, ...rest } = parse(feedInput, req.body);
    const log = await finance.recordFeed(
      farmIdOf(req),
      { ...rest, date: new Date(date) },
      userIdOf(req),
    );
    res.status(201).json({ id: log._id, feedType: log.feedType, qtyKg: log.qtyKg });
  });

  router.get('/summary', requireFarmAccess('finance:read'), async (req, res) => {
    const { from, to } = parse(
      z.object({ from: isoDate.optional(), to: isoDate.optional() }),
      req.query,
    );
    const end = to ? new Date(to) : today();
    const start = from ? new Date(from) : new Date(end.getTime() - 365 * 86_400_000);
    res.json(await finance.profitAndLoss(farmIdOf(req), start, end));
  });

  return router;
}
