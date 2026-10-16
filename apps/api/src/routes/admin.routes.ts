import { Router } from 'express';
import { z } from 'zod';
import { ACCOUNT_STATUSES, SPECIES } from '@nasl/shared';
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
import { createFarmSchema } from '../http/farmInput.ts';
import { reviewAccount } from '../services/accountApproval.service.ts';
import { changeFarmOwner } from '../services/farmOwnership.service.ts';
import { adminInvitationsRoutes } from './adminInvitations.routes.ts';
import type { InvitationMailer } from '../auth/invitationEmail.ts';

const directoryQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  skip: z.coerce.number().int().min(0).default(0),
});
const ownerChange = z
  .object({
    expectedOwnerUserId: z.string().min(1).max(64),
    ownerUserId: z.string().min(1).max(64),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();
const approvalInput = z
  .object({
    status: z.enum(['approved', 'rejected']),
    expectedStatus: z.enum(['pending', 'rejected']),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();
const searchPattern = (q: string) => ({
  $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  $options: 'i',
});

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

const adminFarmInput = createFarmSchema
  .extend({
    ownerIdentifier: z.string().trim().toLowerCase().min(3).max(254),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export function adminRoutes(config: Config, mailer?: InvitationMailer): Router {
  const router = Router();
  router.use(requireAuth(config.JWT_SECRET), requirePlatformAdmin());
  router.use('/invitations', adminInvitationsRoutes(config, mailer));

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

  router.post('/farms', async (req, res) => {
    const { ownerIdentifier, reason, ...input } = parse(adminFarmInput, req.body);
    const owner = await User.findOne({
      ...(ownerIdentifier.includes('@')
        ? { email: ownerIdentifier }
        : { username: ownerIdentifier }),
      status: 'approved',
    })
      .select('_id')
      .lean();
    if (!owner) throw AppError.badRequest('Choose an approved account as the owner.');

    const farm = await Farm.create({ ...input, ownerUserId: owner._id });
    try {
      await Membership.create({
        farmId: farm._id,
        userId: owner._id,
        role: 'owner',
        status: 'active',
        invitedBy: userIdOf(req),
      });
      await recordAudit({
        actorId: userIdOf(req),
        action: 'farm.create',
        targetType: 'farm',
        targetId: farm._id,
        reason: reason || null,
        after: { ...input, ownerUserId: owner._id, plan: farm.plan },
      });
    } catch (error) {
      // Local MongoDB is standalone: compensate if provisioning fails instead of leaving an
      // ownerless or unaudited tenant behind. Only this request's newly created farm is removed.
      await Membership.deleteMany({ farmId: farm._id });
      await Farm.deleteOne({ _id: farm._id });
      throw error;
    }

    res.status(201).json({ id: farm._id, name: farm.name });
  });

  router.get('/farms', async (req, res) => {
    const { q, limit, skip } = parse(directoryQuery, req.query);

    const filter = q
      ? { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      : {};
    const [farms, total] = await Promise.all([
      Farm.find(filter).sort({ createdAt: -1, _id: 1 }).skip(skip).limit(limit).lean().exec(),
      Farm.countDocuments(filter).exec(),
    ]);

    const farmIds = farms.map((f) => f._id);
    const [counts, owners] = await Promise.all([
      Animal.aggregate<{ _id: string; count: number }>([
        { $match: { farmId: { $in: farmIds }, deletedAt: null, status: 'active' } },
        { $group: { _id: '$farmId', count: { $sum: 1 } } },
      ]).exec(),
      User.find({ _id: { $in: farms.map((f) => f.ownerUserId) } })
        .select('name email username')
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
          ownerUserId: f.ownerUserId,
          owner: owner
            ? {
                id: owner._id,
                name: owner.name ?? null,
                email: owner.email,
                username: owner.username,
              }
            : null,
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

    const users = await User.find({
      _id: { $in: [farm.ownerUserId, ...members.map((m) => m.userId)] },
    })
      .select('name email username')
      .lean()
      .exec();
    const userById = new Map(users.map((u) => [u._id, u]));
    const owner = userById.get(farm.ownerUserId);

    res.json({
      id: farm._id,
      name: farm.name,
      ownerUserId: farm.ownerUserId,
      owner: owner
        ? { id: owner._id, name: owner.name ?? null, email: owner.email, username: owner.username }
        : null,
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
        name: userById.get(m.userId)?.name ?? null,
        email: userById.get(m.userId)?.email ?? null,
        username: userById.get(m.userId)?.username ?? null,
        role: m.role,
        status: m.status,
        expiresAt: m.expiresAt?.toISOString() ?? null,
      })),
    });
  });

  router.patch('/farms/:farmId/owner', async (req, res) => {
    const input = parse(ownerChange, req.body);
    const result = await changeFarmOwner(
      {
        ...input,
        farmId: pathParam(req, 'farmId'),
        actorId: userIdOf(req),
      },
      config.NODE_ENV === 'production',
    );
    res.json(result);
  });

  router.get('/users', async (req, res) => {
    const { q, limit, skip, status } = parse(directoryQuery, req.query);
    const filter = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            $or: [
              { name: searchPattern(q) },
              { email: searchPattern(q) },
              { username: searchPattern(q) },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1, _id: 1 }).skip(skip).limit(limit).lean().exec(),
      User.countDocuments(filter),
    ]);
    const counts = await Farm.aggregate<{ _id: string; count: number }>([
      { $match: { ownerUserId: { $in: users.map((u) => u._id) } } },
      { $group: { _id: '$ownerUserId', count: { $sum: 1 } } },
    ]);
    const owned = new Map(counts.map((item) => [item._id, item.count]));
    res.json({
      users: users.map((user) => ({
        id: user._id,
        name: user.name ?? null,
        email: user.email,
        username: user.username,
        status: user.status ?? 'pending',
        locale: user.locale,
        isPlatformAdmin: user.isPlatformAdmin,
        ownedFarmCount: owned.get(user._id) ?? 0,
        createdAt: user.createdAt.toISOString(),
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      })),
      total,
    });
  });

  router.patch('/users/:userId/approval', async (req, res) => {
    const input = parse(approvalInput, req.body);
    res.json(
      await reviewAccount(
        { ...input, userId: pathParam(req, 'userId'), actorId: userIdOf(req) },
        config.NODE_ENV === 'production',
      ),
    );
  });

  router.get('/users/:userId', async (req, res) => {
    const userId = pathParam(req, 'userId');
    const user = await User.findById(userId).lean().exec();
    if (!user) throw AppError.notFound('User not found');
    const memberships = await Membership.find({ userId }).lean().exec();
    const farms = await Farm.find({
      $or: [{ ownerUserId: userId }, { _id: { $in: memberships.map((m) => m.farmId) } }],
    })
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    const owners = await User.find({ _id: { $in: farms.map((f) => f.ownerUserId) } })
      .select('name email username')
      .lean()
      .exec();
    const ownerById = new Map(owners.map((owner) => [owner._id, owner]));
    const membershipByFarm = new Map(memberships.map((m) => [m.farmId, m]));
    res.json({
      id: user._id,
      name: user.name ?? null,
      email: user.email,
      username: user.username,
      status: user.status ?? 'pending',
      locale: user.locale,
      isPlatformAdmin: user.isPlatformAdmin,
      createdAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      farms: farms.map((farm) => {
        const membership = membershipByFarm.get(farm._id);
        const owner = ownerById.get(farm.ownerUserId);
        return {
          id: farm._id,
          name: farm.name,
          plan: farm.plan,
          ownerUserId: farm.ownerUserId,
          owner: owner
            ? {
                id: owner._id,
                name: owner.name ?? null,
                email: owner.email,
                username: owner.username,
              }
            : null,
          role: membership?.role ?? null,
          status: membership?.status ?? null,
          expiresAt: membership?.expiresAt?.toISOString() ?? null,
        };
      }),
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
      .select('name email username')
      .lean()
      .exec();
    const actorById = new Map(actors.map((a) => [a._id, a]));
    const farms = await Farm.find({
      _id: { $in: entries.filter((e) => e.targetType === 'farm').map((e) => e.targetId) },
    })
      .select('name')
      .lean()
      .exec();
    const farmNames = new Map(farms.map((farm) => [farm._id, farm.name]));

    res.json({
      entries: entries.map((e) => ({
        id: e._id,
        actor: {
          id: e.actorId,
          name: actorById.get(e.actorId)?.name ?? null,
          email: actorById.get(e.actorId)?.email ?? null,
          username: actorById.get(e.actorId)?.username ?? null,
        },
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        targetName: e.targetType === 'farm' ? (farmNames.get(e.targetId) ?? null) : null,
        reason: e.reason ?? null,
        before: e.before ?? null,
        after: e.after ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });

  return router;
}
