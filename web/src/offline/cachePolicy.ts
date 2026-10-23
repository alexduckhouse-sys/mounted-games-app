/** Only responses with the same public representation for every viewer. */
export function canCachePublicApi(pathname: string, method = 'GET'): boolean {
  if (method !== 'GET') return false;
  return /^\/api\/competitions(?:\/picker|\/[1-9]\d*(?:\/standings)?)?\/?$/.test(pathname)
    || /^\/api\/competitions\/[1-9]\d*\/sponsors\/?$/.test(pathname)
    || /^\/api\/(?:race-templates|weather\/(?:at|current))\/?$/.test(pathname);
}

export async function stampPublicResponse(response: Response): Promise<Response | null> {
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) return null;
  const headers = new Headers(response.headers);
  headers.set('X-MG-Saved-At', new Date().toISOString());
  return new Response(await response.clone().blob(), { status: 200, headers });
}

export function markSavedResponse(response: Response | undefined): Response | undefined {
  if (!response) return undefined;
  const headers = new Headers(response.headers);
  headers.set('X-MG-Saved-Copy', '1');
  return new Response(response.clone().body, { status: response.status, headers });
}

/** Set by the embedded widget on its own requests (see hooks/useEmbedResource.ts). */
export const EMBED_REQUEST_HEADER = 'X-MG-Embed';

/**
 * The embedded widget on a club's site must not read or fill this app's saved copies. When the frame is
 * on our own origin (the organiser's preview) the service worker would otherwise treat it like the app.
 */
export function isEmbedRequest(headers: { get(name: string): string | null }): boolean {
  return headers.get(EMBED_REQUEST_HEADER) === '1';
}

/** Navigations the service worker leaves to the network: the API and hub, and /embed/ pages, which carry their own framing headers. */
export const NAVIGATION_DENYLIST: RegExp[] = [/^\/api(?:\/|$)/, /^\/hubs(?:\/|$)/, /^\/embed(?:\/|$)/];
