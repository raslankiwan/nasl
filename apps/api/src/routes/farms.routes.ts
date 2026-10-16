import { Router } from 'express';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { Farm } from '../models/farm.model.ts';
import { Membership } from '../models/membership.model.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requireFarmAccess } from '../middleware/requireFarmAccess.ts';
import { createFarmSchema } from '../http/farmInput.ts';

export function farmRoutes(config: Config): Router {
  const router = Router();
  router.use(requireAuth(config.JWT_SECRET));

  router.post('/', async (req, res) => {
    const parsed = createFarmSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.badRequest('Check the details and try again.');
    const userId = req.auth!.userId;

    const farm = await Farm.create({ ...parsed.data, ownerUserId: userId });
    await Membership.create({ farmId: farm._id, userId, role: 'owner', status: 'active' });

    res.status(201).json({ id: farm._id, name: farm.name, role: 'owner' });
  });

  router.get('/', async (req, res) => {
    const memberships = await Membership.find({ userId: req.auth!.userId, status: 'active' })
      .lean()
      .exec();
    const farms = await Farm.find({ _id: { $in: memberships.map((m) => m.farmId) } })
      .lean()
      .exec();
    const roleFor = new Map(memberships.map((m) => [m.farmId, m.role]));

    res.json({
      farms: farms.map((f) => ({
        id: f._id,
        name: f.name,
        currency: f.currency,
        species: f.species,
        calendarPreference: f.calendarPreference,
        role: roleFor.get(f._id) ?? null,
      })),
    });
  });

  router.get('/:farmId', requireFarmAccess('animals:read'), async (req, res) => {
    const farm = await Farm.findById(req.membership!.farmId).lean().exec();
    if (!farm) throw AppError.notFound();
    res.json({
      id: farm._id,
      name: farm.name,
      country: farm.country,
      currency: farm.currency,
      timezone: farm.timezone,
      species: farm.species,
      calendarPreference: farm.calendarPreference,
      plan: farm.plan,
      role: req.membership!.role,
    });
  });

  return router;
}
