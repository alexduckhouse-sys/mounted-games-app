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
