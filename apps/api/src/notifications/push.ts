import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { birthReminders, can, type Role } from '@nasl/shared';
import { ar, en, formatDate } from '@nasl/i18n';
import type { Config } from '../config.ts';
import type { Logger } from '../logger.ts';
import { Animal } from '../models/animal.model.ts';
import { Farm } from '../models/farm.model.ts';
import { Membership } from '../models/membership.model.ts';
import { User } from '../models/user.model.ts';
import { PushSubscription, type PushSubscriptionDoc } from '../models/pushSubscription.model.ts';
import { TenantRepository } from '../repositories/tenantRepository.ts';

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}
export type PushSender = (subscription: PushSubscriptionDoc, message: PushMessage) => Promise<void>;
export const endpointHash = (endpoint: string) =>
  createHash('sha256').update(endpoint).digest('hex');
export const pushConfigured = (config: Config) =>
  Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT);

/** Never let an account turn the server into a requester to an arbitrary URL. */
export function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (url.hostname === 'fcm.googleapis.com' ||
        url.hostname === 'updates.push.services.mozilla.com' ||
        url.hostname.endsWith('.push.services.mozilla.com') ||
        url.hostname === 'web.push.apple.com' ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}

export function webPushSender(config: Config): PushSender {
  return async (subscription, message) => {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({ ...message, userId: subscription.userId }),
      {
        vapidDetails: {
          subject: config.VAPID_SUBJECT!,
          publicKey: config.VAPID_PUBLIC_KEY!,
          privateKey: config.VAPID_PRIVATE_KEY!,
        },
        TTL: 86400,
        urgency: 'normal',
        timeout: 4000,
      },
    );
  };
}

function localDay(now: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  return new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`);
}

const animals = new TenantRepository(Animal);
export async function remindersFor(subscription: PushSubscriptionDoc, now: Date) {
  if (!(await User.exists({ _id: subscription.userId, status: 'approved' }))) return [];
  const memberships = await Membership.find({
    userId: subscription.userId,
    status: 'active',
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).lean();
  const reminders = [];
  for (const membership of memberships) {
    if (!can(membership.role as Role, 'animals:read')) continue;
    const farm = await Farm.findById(membership.farmId).lean();
    if (!farm) continue;
    const flock = await animals.find(farm._id, {
      status: 'active',
      sex: 'female',
      'repro.state': { $in: ['mated', 'pregnant', 'due'] },
    });
    const rows = birthReminders(
      flock.map((animal) => ({ ...animal, id: animal._id })),
      localDay(now, farm.timezone),
      subscription.leadDays,
    );
    for (const row of rows) {
      const animal = flock.find((a) => a._id === row.animalId)!;
      reminders.push({
        ...row,
        farmId: farm._id,
        key: endpointHash(
          `${farm._id}:${row.animalId}:${animal.repro?.matingId}:${row.windowStart}:${row.windowEnd}`,
        ),
      });
    }
  }
  return reminders.sort(
    (a, b) => a.windowStart.localeCompare(b.windowStart) || a.key.localeCompare(b.key),
  );
}

export function reminderMessage(
  subscription: PushSubscriptionDoc,
  rows: Awaited<ReturnType<typeof remindersFor>>,
): PushMessage {
  const first = rows[0]!;
  const copy = (subscription.locale === 'en' ? en : ar).notifications;
  const vars: Record<string, string> = {
    count: String(rows.length),
    tag: `\u2068${first.tagNumber}\u2069`,
    start: `\u2068${formatDate(new Date(first.windowStart), subscription.locale)}\u2069`,
    end: `\u2068${formatDate(new Date(first.windowEnd), subscription.locale)}\u2069`,
  };
  return {
    title: copy.pushTitle,
    body: copy.pushBody
      .replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
      .slice(0, 1000),
    url: `/notification?farmId=${encodeURIComponent(first.farmId)}&animalId=${encodeURIComponent(first.animalId)}`,
    tag: `nasl-birth-${endpointHash(rows.map((r) => r.key).join(':')).slice(0, 24)}`,
  };
}

/** One digest per device, only new pregnancies. Leases exclude overlapping cron invocations. */
export async function dispatchBirthReminders(send: PushSender, logger: Logger, now = new Date()) {
  const stats = { sent: 0, failed: 0, expired: 0, checked: 0, deferred: 0 };
  const total = await PushSubscription.countDocuments({ enabled: true });
  const subscriptions = await PushSubscription.find({ enabled: true })
    .sort({ lastCheckedAt: 1 })
    .limit(500)
    .lean();
  const deadline = Date.now() + 45_000;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (cursor < subscriptions.length && Date.now() < deadline) {
        const next = subscriptions[cursor++]!;
        const subscription = await PushSubscription.findOneAndUpdate(
          { _id: next._id, enabled: true, leaseUntil: { $lte: now } },
          { $set: { leaseUntil: new Date(now.getTime() + 120_000) } },
          { new: true },
        ).lean();
        if (!subscription) continue;
        try {
          const rows = await remindersFor(subscription, now);
          const pending = rows.filter((r) => !subscription.notifiedKeys.includes(r.key));
          // Recheck opt-out just before transmission; a settings update may have happened mid-run.
          if (
            pending.length &&
            (await PushSubscription.exists({ _id: subscription._id, enabled: true }))
          ) {
            await send(subscription, reminderMessage(subscription, pending));
            stats.sent++;
          }
          await PushSubscription.updateOne(
            { _id: subscription._id },
            { $set: { notifiedKeys: rows.map((r) => r.key), lastCheckedAt: now } },
          );
          stats.checked++;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await PushSubscription.deleteOne({ _id: subscription._id });
            stats.expired++;
          } else {
            stats.failed++;
            // Do not log endpoints, encryption keys, payloads or provider response bodies.
            logger.warn(
              { subscriptionId: subscription._id, status },
              'Birth push failed; eligible reminders will retry on the next run',
            );
            await PushSubscription.updateOne(
              { _id: subscription._id },
              { $set: { lastCheckedAt: now } },
            );
          }
        } finally {
          await PushSubscription.updateOne(
            { _id: subscription._id },
            { $set: { leaseUntil: new Date(0) } },
          );
        }
      }
    }),
  );
  stats.deferred = Math.max(0, total - cursor);
  return stats;
}
