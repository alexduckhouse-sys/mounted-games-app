/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope;

// Precache the app shell — emitted by vite-plugin-pwa at build time.
precacheAndRoute(self.__WB_MANIFEST);

// User-generated / mutation-heavy endpoints must NEVER be cached — a 24h
// cached list would mask a freshly-posted shop entry or new signup so it
// looks like the POST silently failed. NetworkOnly for these.
const NETWORK_ONLY_PREFIXES = [
  '/api/shop/',
  '/api/signups',
  '/api/competitions/',  // catches /signups, /signups-locked, /form-teams etc.
  '/api/me/',
  '/api/declaration-forms',
  '/api/push/',
  '/api/auth/',
  '/api/ip-blocks',
  '/api/teams/',
  '/api/team-supporters/',
  '/api/trainer/',
] as const;
function isNetworkOnly(pathname: string): boolean {
  return NETWORK_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
}

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/') && isNetworkOnly(url.pathname),
  new NetworkOnly(),
);

// Other API responses (race templates, weather, clubs, geocode) cached for
// offline viewing — these change rarely and tolerate staleness.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/') && !isNetworkOnly(url.pathname),
  new NetworkFirst({
    cacheName: 'mg-api',
    networkTimeoutSeconds: 4,
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
);

// SignalR is realtime — don't try to cache it.
registerRoute(({ url }) => url.pathname.startsWith('/hubs/'), new NetworkOnly());

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

interface PushPayload {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
}

// Handle incoming push messages from the backend.
self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {};
  try {
    if (event.data) payload = event.data.json() as PushPayload;
  } catch { /* not JSON — fall back to defaults */ }
  const title = payload.title?.trim() || 'Mounted Games';
  const body = payload.body?.trim() || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: payload.tag,
      data: { url: payload.url ?? '/' },
    }),
  );
});

// Click on a notification → focus an existing tab or open one.
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | null)?.url ?? '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await (client as WindowClient).navigate(target).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
