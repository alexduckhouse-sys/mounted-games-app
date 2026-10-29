/** Only immutable build assets belong in the lazy asset cache. */
export function isLazyBuildAsset(url: URL, origin: string, method: string): boolean {
  return method === 'GET' && url.origin === origin
    && /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(url.pathname);
}

export function canCacheBuildAsset(response: Response): boolean {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  return response.status === 200 && !response.redirected
    && (type === 'text/css' || type === 'text/javascript' || type === 'application/javascript');
}
