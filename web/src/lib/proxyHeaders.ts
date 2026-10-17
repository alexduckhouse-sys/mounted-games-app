/**
 * Headers the API trusts to identify a visitor behind Vercel's /api proxy
 * (see api/Security/ProxyClientIpMiddleware.cs). Only Vercel's routing middleware sets them.
 */
export const PROXY_KEY_HEADER = 'x-mg-proxy-key';
export const CLIENT_IP_HEADER = 'x-mg-client-ip';

/**
 * The request headers to forward to the API: the original ones, with the visitor's IP and the shared
 * proxy key added. Anything a browser sent under these names is dropped first, so it can't be forged.
 * Without a key or an IP nothing is added, and the API treats the request as before.
 */
export function proxyRequestHeaders(original: Headers, clientIp: string | undefined, key: string | undefined): Headers {
  const headers = new Headers(original);
  headers.delete(PROXY_KEY_HEADER);
  headers.delete(CLIENT_IP_HEADER);
  if (key && clientIp) {
    headers.set(PROXY_KEY_HEADER, key);
    headers.set(CLIENT_IP_HEADER, clientIp);
  }
  return headers;
}
