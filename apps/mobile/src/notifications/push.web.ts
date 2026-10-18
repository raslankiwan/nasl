import { api } from '../api/client';
import type { PushState, PushSupport } from './push';
export type { PushState, PushSupport } from './push';

const OWNER_CACHE = 'nasl-push-preferences';
const OWNER_PATH = '/__nasl_push_owner__';
export function pushSupport(): PushSupport {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (
    ios &&
    !window.matchMedia('(display-mode: standalone)').matches &&
    !(navigator as Navigator & { standalone?: boolean }).standalone
  )
    return 'install';
  return window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
    ? 'supported'
    : 'unsupported';
}
async function subscription() {
  return (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
}
export async function readPushState(userId: string): Promise<PushState> {
  const config = await api.get<{ available: boolean }>('/v1/notifications/config');
  const sub = pushSupport() === 'supported' ? await subscription() : null;
  const owner = await (await (await caches.open(OWNER_CACHE)).match(OWNER_PATH))?.text();
  if (!sub || owner !== userId) return { ...config, enabled: false, reminderDays: [0] };
  const state = await api.post<{ enabled: boolean; reminderDays: number[] }>(
    '/v1/notifications/status',
    {
      endpoint: sub.endpoint,
    },
  );
  return { ...config, ...state, enabled: state.enabled && Notification.permission === 'granted' };
}

/** Enabling opts into the new worker without reloading or losing an open form/outbox. */
async function pushWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  await reg.update();
  const worker = reg.installing ?? reg.waiting;
  if (worker)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.removeEventListener('statechange', changed);
        reject(new Error('worker_timeout'));
      }, 12000);
      const changed = () => {
        if (worker.state === 'installed') worker.postMessage({ type: 'ENABLE_PUSH_WORKER' });
        if (worker.state === 'activated' || worker.state === 'redundant') {
          clearTimeout(timer);
          worker.removeEventListener('statechange', changed);
          if (worker.state === 'activated') resolve();
          else reject(new Error('worker_unavailable'));
        }
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
  return navigator.serviceWorker.ready;
}
export async function enablePush(
  userId: string,
  locale: string,
  reminderDays: number[],
): Promise<void> {
  // Must be the first async operation in this user gesture, especially on iOS.
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('permission_denied');
  const config = await api.get<{ available: boolean; publicKey: string }>(
    '/v1/notifications/config',
  );
  if (!config.available) throw new Error('push_unavailable');
  const reg = await pushWorker();
  const cache = await caches.open(OWNER_CACHE);
  const owner = await (await cache.match(OWNER_PATH))?.text();
  let sub = await reg.pushManager.getSubscription();
  if (sub && owner !== userId) {
    await sub.unsubscribe();
    sub = null;
  }
  const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.post('/v1/notifications/subscribe', {
    ...sub.toJSON(),
    locale: locale.startsWith('en') ? 'en' : 'ar',
    reminderDays,
  });
  await cache.put(OWNER_PATH, new Response(userId));
}
export async function forgetPushOwner(): Promise<void> {
  if ('caches' in window) await (await caches.open(OWNER_CACHE)).delete(OWNER_PATH);
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration('/');
    for (const notification of (await reg?.getNotifications()) ?? []) notification.close();
  }
}
export async function disablePush(): Promise<void> {
  // Local opt-out takes effect even offline: a queued message cannot expose the last user's flock.
  await forgetPushOwner();
  if (!('serviceWorker' in navigator)) return;
  const sub = await subscription();
  if (!sub) return;
  const unregister = api
    .post('/v1/notifications/disable', { endpoint: sub.endpoint })
    .catch(() => {});
  await sub.unsubscribe();
  // A failing connection must not hold the sign-out screen indefinitely.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    unregister,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 3000);
    }),
  ]);
  if (timer) clearTimeout(timer);
}
export async function testPush(): Promise<void> {
  const sub = await subscription();
  if (!sub) throw new Error('subscription_missing');
  await api.post('/v1/notifications/test', { endpoint: sub.endpoint });
}

export async function reconcilePushOwner(userId: string): Promise<void> {
  if (!('caches' in window)) return;
  const owner = await (await (await caches.open(OWNER_CACHE)).match(OWNER_PATH))?.text();
  if (owner && owner !== userId) await disablePush();
}
