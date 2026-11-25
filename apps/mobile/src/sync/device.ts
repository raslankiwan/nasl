import { platformLock } from '../platformLock';
import { request } from '../api/client';
import { FlockCache, type PullResponse } from './cache';
import { createPullFlock } from './pull';
import { Outbox } from './outbox';
import { ReminderStore } from '../reminders/reminders';
import { tolerant } from './storage';
import { deviceStore } from './storage.native';

/**
 * The app's instances, wired to device storage.
 *
 * The one place that knows both the pure logic and the platform. Tests construct their own with a
 * memory store, and swapping AsyncStorage for SQLite is a change to `storage.native.ts` alone.
 */
export const outbox = new Outbox(deviceStore, (work) => platformLock('nasl.outbox', work));
export const flockCache = new FlockCache(tolerant(deviceStore));
export const reminderStore = new ReminderStore(tolerant(deviceStore));

/**
 * Fetch what has changed since the last pull and fold it into the cache.
 *
 * Incremental after the first call: the cursor the cache holds is what makes a later sync cost
 * only what moved. It lives here rather than on the cache so the merge logic stays testable
 * without a network.
 */
export const pullFlock = createPullFlock(flockCache, (farmId, body) =>
  request<PullResponse>(`/v1/farms/${farmId}/sync/pull`, { method: 'POST', body }),
);
