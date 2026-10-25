/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { canCachePublicApi, isEmbedRequest, markSavedResponse, NAVIGATION_DENYLIST, stampPublicResponse } from './offline/cachePolicy';

declare const self: ServiceWorkerGlobalScope;

// Precache the app shell — emitted by vite-plugin-pwa at build time.
precacheAndRoute(self.__WB_MANIFEST);

// A saved app shell must also serve direct links opened without a connection.
if (import.meta.env.PROD) {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: NAVIGATION_DENYLIST,
  }));
}

registerRoute(
  ({ url, request }) => url.origin === self.location.origin && canCachePublicApi(url.pathname, request.method) && !isEmbedRequest(request.headers),
  new NetworkFirst({
    cacheName: 'mg-public-api-v2',
    networkTimeoutSeconds: 4,
    plugins: [
      {
        cacheWillUpdate: async ({ response }: { response: Response }) => stampPublicResponse(response),
        cachedResponseWillBeUsed: async ({ cachedResponse }: { cachedResponse?: Response }) => markSavedResponse(cachedResponse),
      },
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  }),
);

// Account data, forms and writes always go to the server.
registerRoute(({ url }) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/hubs/'), new NetworkOnly());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await caches.delete('mg-api');
    await self.clients.claim();
  })());
});
// Allow the existing refresh prompt to activate a waiting update.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

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
