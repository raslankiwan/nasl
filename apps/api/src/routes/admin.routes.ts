import { Router } from 'express';
import { z } from 'zod';
import { SPECIES } from '@nasl/shared';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { Animal } from '../models/animal.model.ts';
import { AuditLog, recordAudit } from '../models/auditLog.model.ts';
import { Farm } from '../models/farm.model.ts';
import { Membership } from '../models/membership.model.ts';
import { User } from '../models/user.model.ts';
import { PRODUCT_KINDS, VetProduct } from '../models/vetProduct.model.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { requirePlatformAdmin } from '../middleware/requirePlatformAdmin.ts';
import { parse, pathParam, userIdOf } from '../http/validate.ts';

const productInput = z.object({
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  kind: z.enum(PRODUCT_KINDS),
  activeIngredient: z.string().trim().max(120).optional(),
  withdrawalMeatDays: z.number().int().min(0).max(365),
  withdrawalMilkDays: z.number().int().min(0).max(365),
  species: z.array(z.enum(SPECIES)).min(1).default(['sheep', 'goat']),
  manufacturer: z.string().trim().max(120).optional(),
  /** Required, because an unsourced withdrawal figure is a guess. */
  source: z.string().trim().min(1).max(300),
  isActive: z.boolean().default(true),
});

const planChange = z.object({
  plan: z.enum(['free', 'standard', 'commercial']),
  reason: z.string().trim().min(3).max(300),
});

export function adminRoutes(config: Config): Router {
  const router = Router();
  router.use(requireAuth(config.JWT_SECRET), requirePlatformAdmin());

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  router.get('/stats', async (_req, res) => {
    const [farms, users, animals, byPlan] = await Promise.all([
      Farm.countDocuments().exec(),
      User.countDocuments().exec(),
      Animal.countDocuments({ deletedAt: null, status: 'active' }).exec(),
      Farm.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ]).exec(),
    ]);

    res.json({
      farms,
      users,
      activeAnimals: animals,
      plans: Object.fromEntries(byPlan.map((p) => [p._id, p.count])),
    });
  });

  // -------------------------------------------------------------------------
  // Tenant directory (FR-ADM-01)
  // -------------------------------------------------------------------------

  router.get('/farms', async (req, res) => {
    const { q, limit, skip } = parse(
      z.object({
        q: z.string().trim().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        skip: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );

    const filter = q
      ? { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      : {};
    const [farms, total] = await Promise.all([
      Farm.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      Farm.countDocuments(filter).exec(),
    ]);

    const farmIds = farms.map((f) => f._id);
    const [counts, owners] = await Promise.all([
      Animal.aggregate<{ _id: string; count: number }>([
        { $match: { farmId: { $in: farmIds }, deletedAt: null, status: 'active' } },
        { $group: { _id: '$farmId', count: { $sum: 1 } } },
      ]).exec(),
      User.find({ _id: { $in: farms.map((f) => f.ownerUserId) } })
        .select('name phone')
        .lean()
        .exec(),
    ]);
    const headCount = new Map(counts.map((c) => [c._id, c.count]));
    const ownerById = new Map(owners.map((o) => [o._id, o]));

    res.json({
      farms: farms.map((f) => {
        const owner = ownerById.get(f.ownerUserId);
        return {
          id: f._id,
          name: f.name,
          country: f.country,
          currency: f.currency,
          plan: f.plan,
          species: f.species,
          headCount: headCount.get(f._id) ?? 0,
          // The console shows who to call, not a browsable contact list.
          owner: owner ? { id: owner._id, name: owner.name ?? null } : null,
          createdAt: f.createdAt.toISOString(),
        };
      }),
      total,
    });
  });

  router.get('/farms/:farmId', async (req, res) => {
    const farmId = pathParam(req, 'farmId');
    const farm = await Farm.findById(farmId).lean().exec();
    if (!farm) throw AppError.notFound('Farm not found');

    const [headCount, members, lastChange] = await Promise.all([
      Animal.countDocuments({ farmId, deletedAt: null, status: 'active' }).exec(),
      Membership.find({ farmId }).lean().exec(),
      Animal.findOne({ farmId }).sort({ updatedAt: -1 }).select('updatedAt').lean().exec(),
    ]);

    const users = await User.find({ _id: { $in: members.map((m) => m.userId) } })
      .select('name')
      .lean()
      .exec();
    const nameById = new Map(users.map((u) => [u._id, u.name ?? null]));

    res.json({
      id: farm._id,
      name: farm.name,
      country: farm.country,
      currency: farm.currency,
      timezone: farm.timezone,
      species: farm.species,
      calendarPreference: farm.calendarPreference,
      plan: farm.plan,
      headCount,
      // A proxy for sync health until the sync endpoints land in Increment 5.
      lastActivityAt: lastChange?.updatedAt?.toISOString() ?? null,
      createdAt: farm.createdAt.toISOString(),
      members: members.map((m) => ({
        userId: m.userId,
        name: nameById.get(m.userId) ?? null,
        role: m.role,
        status: m.status,
        expiresAt: m.expiresAt?.toISOString() ?? null,
      })),
    });
  });

  router.patch('/farms/:farmId/plan', async (req, res) => {
    const { plan, reason } = parse(planChange, req.body);
    const farmId = pathParam(req, 'farmId');

    const farm = await Farm.findById(farmId).exec();
    if (!farm) throw AppError.notFound('Farm not found');

    const before = farm.plan;
    farm.plan = plan;
    await farm.save();

    await recordAudit({
      actorId: userIdOf(req),
      action: 'farm.plan.change',
      targetType: 'farm',
      targetId: farmId,
      reason,
      before: { plan: before },
      after: { plan },
    });

    res.json({ id: farm._id, plan: farm.plan });
  });

  // -------------------------------------------------------------------------
  // Veterinary product library (FR-ADM-03)
  // -------------------------------------------------------------------------

  router.get('/products', async (req, res) => {
    const { kind, includeInactive } = parse(
      z.object({
        kind: z.enum(PRODUCT_KINDS).optional(),
        includeInactive: z.coerce.boolean().default(false),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (kind) filter.kind = kind;
    if (!includeInactive) filter.isActive = true;

    const products = await VetProduct.find(filter).sort({ nameEn: 1 }).lean().exec();
    res.json({ products });
  });

  router.post('/products', async (req, res) => {
    const input = parse(productInput, req.body);
    const created = await VetProduct.create(input);

    await recordAudit({
      actorId: userIdOf(req),
      action: 'product.create',
      targetType: 'vetProduct',
      targetId: created._id,
      reason: `Added from ${input.source}`,
      after: input,
    });

    res.status(201).json(created.toObject());
  });

  router.patch('/products/:productId', async (req, res) => {
    const patch = parse(
      productInput.partial().extend({ reason: z.string().trim().min(3) }),
      req.body,
    );
    const { reason, ...fields } = patch;
    const productId = pathParam(req, 'productId');

    const existing = await VetProduct.findById(productId).lean().exec();
    if (!existing) throw AppError.notFound('Product not found');

    const updated = await VetProduct.findByIdAndUpdate(productId, { $set: fields }, { new: true })
      .lean()
      .exec();

    // Withdrawal changes are the ones that matter; record the whole before/after regardless.
    await recordAudit({
      actorId: userIdOf(req),
      action: 'product.update',
      targetType: 'vetProduct',
      targetId: productId,
      reason,
      before: {
        withdrawalMeatDays: existing.withdrawalMeatDays,
        withdrawalMilkDays: existing.withdrawalMilkDays,
      },
      after: fields,
    });

    res.json(updated);
  });

  // -------------------------------------------------------------------------
  // Audit trail (FR-ADM-06)
  // -------------------------------------------------------------------------

  router.get('/audit', async (req, res) => {
    const { targetType, targetId, limit } = parse(
      z.object({
        targetType: z.string().max(40).optional(),
        targetId: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    const filter: Record<string, unknown> = {};
    if (targetType) filter.targetType = targetType;
    if (targetId) filter.targetId = targetId;

    const entries = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean().exec();
    const actors = await User.find({ _id: { $in: entries.map((e) => e.actorId) } })
      .select('name')
      .lean()
      .exec();
    const nameById = new Map(actors.map((a) => [a._id, a.name ?? null]));

    res.json({
      entries: entries.map((e) => ({
        id: e._id,
        actor: { id: e.actorId, name: nameById.get(e.actorId) ?? null },
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        reason: e.reason ?? null,
        before: e.before ?? null,
        after: e.after ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });

  return router;
}
