import { timingSafeEqual, createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ar, en } from '@nasl/i18n';
import type { Config } from '../config.ts';
import type { Logger } from '../logger.ts';
import { AppError } from '../errors.ts';
import { parse, userIdOf } from '../http/validate.ts';
import { requireAuth } from '../middleware/requireAuth.ts';
import { PushSubscription } from '../models/pushSubscription.model.ts';
import {
  allowedPushEndpoint,
  dispatchBirthReminders,
  endpointHash,
  pushConfigured,
  type PushSender,
} from './push.ts';

const endpointInput = z.object({
  endpoint: z.string().max(2048).refine(allowedPushEndpoint, 'Unsupported push endpoint'),
});
const subscriptionInput = endpointInput.extend({
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
  locale: z.enum(['ar', 'en']).default('ar'),
  leadDays: z.union([z.literal(1), z.literal(3), z.literal(7)]).default(3),
});

export function notificationRoutes(config: Config, send: PushSender) {
  const router = Router();
  router.use(requireAuth(config.JWT_SECRET));
  router.get('/config', (_req, res) =>
    res.json({ available: pushConfigured(config), publicKey: config.VAPID_PUBLIC_KEY ?? null }),
  );
  router.post('/status', async (req, res) => {
    const { endpoint } = parse(endpointInput, req.body);
    const subscription = await PushSubscription.findOne({
      userId: userIdOf(req),
      endpointHash: endpointHash(endpoint),
    }).lean();
    res.json({ enabled: subscription?.enabled ?? false, leadDays: subscription?.leadDays ?? 3 });
  });
  router.post('/subscribe', async (req, res) => {
    if (!pushConfigured(config))
      throw new AppError('push_unavailable', 'Push notifications are not configured.');
    const input = parse(subscriptionInput, req.body);
    const userId = userIdOf(req);
    const hash = endpointHash(input.endpoint);
    const existing = await PushSubscription.findOne({ endpointHash: hash }).lean();
    if (existing && existing.userId !== userId)
      throw AppError.conflict(
        'This browser subscription belongs to another account. Disable it and try again.',
      );
    if (!existing && (await PushSubscription.countDocuments({ userId })) >= 10)
      throw AppError.badRequest('A maximum of ten notification devices is allowed.');
    try {
      await PushSubscription.findOneAndUpdate(
        { endpointHash: hash, userId },
        {
          $set: { ...input, enabled: true },
          $setOnInsert: { userId, endpointHash: hash },
        },
        { upsert: true, runValidators: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw AppError.conflict('Subscription changed. Try again.');
      throw error;
    }
    res.json({ enabled: true, leadDays: input.leadDays });
  });
  router.post('/disable', async (req, res) => {
    const { endpoint } = parse(endpointInput, req.body);
    await PushSubscription.deleteOne({
      userId: userIdOf(req),
      endpointHash: endpointHash(endpoint),
    });
    res.json({ enabled: false });
  });
  router.post('/test', async (req, res) => {
    if (!pushConfigured(config))
      throw new AppError('push_unavailable', 'Push notifications are not configured.');
    const { endpoint } = parse(endpointInput, req.body);
    const now = new Date();
    const subscription = await PushSubscription.findOneAndUpdate(
      {
        userId: userIdOf(req),
        endpointHash: endpointHash(endpoint),
        enabled: true,
        lastTestAt: { $lte: new Date(now.getTime() - 60_000) },
      },
      { $set: { lastTestAt: now } },
      { new: true },
    ).lean();
    if (!subscription)
      throw new AppError(
        'rate_limited',
        'Enable notifications first, or wait a minute before another test.',
      );
    const copy = (subscription.locale === 'en' ? en : ar).notifications;
    try {
      await send(subscription, {
        title: copy.pushTitle,
        body: copy.testBody,
        url: '/settings',
        tag: 'nasl-push-test',
      });
    } catch (error) {
      if ([404, 410].includes((error as { statusCode?: number }).statusCode ?? 0))
        await PushSubscription.deleteOne({ _id: subscription._id });
      throw new AppError(
        'push_unavailable',
        'Could not send the test notification. Re-enable notifications and retry.',
      );
    }
    res.json({ sent: true });
  });
  return router;
}

export function notificationCron(config: Config, send: PushSender, logger: Logger) {
  const router = Router();
  router.get('/birth-reminders', async (req, res) => {
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (
      !config.CRON_SECRET ||
      !timingSafeEqual(
        digest(req.headers.authorization ?? ''),
        digest(`Bearer ${config.CRON_SECRET}`),
      )
    )
      throw AppError.unauthorized();
    if (!pushConfigured(config))
      throw new AppError('push_unavailable', 'Push notifications are not configured.');
    const result = await dispatchBirthReminders(send, logger);
    logger.info(result, 'Birth reminder dispatch complete');
    res.status(result.failed || result.deferred ? 503 : 200).json(result);
  });
  return router;
}
