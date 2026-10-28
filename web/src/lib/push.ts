import { api } from '../api';

const PUSH_READY_TIMEOUT_MS = 10_000;

export type PushReadiness = 'unsupported' | 'default' | 'denied' | 'not-subscribed' | 'ready' | 'error';

// A service worker may never activate (for example after a failed install).
// Stop waiting without continuing subscription work if it becomes ready later.
async function waitForPush<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Push readiness timed out')), PUSH_READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads this browser's state without requesting permission or contacting the API.
 * `ready` means a browser subscription exists; it does not prove server registration
 * or delivery. `default` means permission has not yet been granted or denied.
 */
export async function readPushReadiness(): Promise<PushReadiness> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission !== 'granted') return Notification.permission;
  try {
    const reg = await waitForPush(navigator.serviceWorker.ready);
    const subscription = await waitForPush(reg.pushManager.getSubscription());
    return subscription ? 'ready' : 'not-subscribed';
  } catch {
    return 'error';
  }
}

/** Decodes a base64url VAPID key into a fresh ArrayBuffer (what PushManager wants). */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** Why switching alerts on did or didn't work. "server" is our side refusing or unreachable; "browser" is the browser refusing. */
export type PushResult = 'ok' | 'unsupported' | 'denied' | 'browser' | 'server';

/**
 * Subscribe the browser for web-push notifications and register the endpoint
 * with the backend, and say how it went. Only 'ok' means alerts will arrive.
 */
export async function subscribeForPushResult(): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'browser';
  let sub: globalThis.PushSubscription | null;
  try {
    const reg = await waitForPush(navigator.serviceWorker.ready);
    sub = await waitForPush(reg.pushManager.getSubscription());
    if (!sub) {
      let publicKey: string;
      try {
        publicKey = (await api.get<{ publicKey: string }>('/push/vapid-public-key')).data.publicKey;
      } catch { return 'server'; }
      if (!publicKey) return 'server';
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(publicKey),
      });
    }
  } catch {
    return 'browser';
  }
  try {
    await sendSubscription(sub);
    return 'ok';
  } catch {
    return 'server';
  }
}

/** True only when the browser is subscribed and the server accepted it. */
export async function subscribeForPush(): Promise<boolean> {
  return (await subscribeForPushResult()) === 'ok';
}

/**
 * Drops this browser's push subscription and tells the server to forget it. Pass the token when signing out:
 * the stored login is already gone by the time the request is sent, so the call has to carry its own.
 */
export async function unsubscribeFromPush(token?: string | null): Promise<void> {
  if (!pushSupported()) return;
  const headers = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  try {
    const reg = await waitForPush(navigator.serviceWorker.ready);
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      try {
        await api.delete('/push/subscribe', { params: { endpoint }, ...headers });
      } catch { /* server may already have purged the row */ }
    } else {
      // No browser subscription but server may still have one for us.
      await (token ? api.delete('/push/subscribe', headers) : api.delete('/push/subscribe')).catch(() => {});
    }
  } catch { /* swallow */ }
}

function toBase64(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

async function sendSubscription(sub: globalThis.PushSubscription): Promise<void> {
  const p256dh = toBase64(sub.getKey('p256dh'));
  const auth = toBase64(sub.getKey('auth'));
  await api.post('/push/subscribe', {
    endpoint: sub.endpoint,
    p256dh,
    auth,
  });
}
