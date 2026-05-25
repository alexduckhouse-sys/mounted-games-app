import { api } from '../api';

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

/**
 * Subscribe the browser for web-push notifications and register the endpoint
 * with the backend. No-op if push isn't supported or the user hasn't granted
 * notification permission yet.
 */
export async function subscribeForPush(): Promise<boolean> {
  if (!pushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await sendSubscription(existing);
      return true;
    }
    const { data } = await api.get<{ publicKey: string }>('/push/vapid-public-key');
    if (!data.publicKey) return false;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(data.publicKey),
    });
    await sendSubscription(sub);
    return true;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      try {
        await api.delete('/push/subscribe', { params: { endpoint } });
      } catch { /* server may already have purged the row */ }
    } else {
      // No browser subscription but server may still have one for us.
      await api.delete('/push/subscribe').catch(() => {});
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
