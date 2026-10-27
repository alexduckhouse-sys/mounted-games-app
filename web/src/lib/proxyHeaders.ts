// Unused in web UI yet — reserved for iOS / upcoming wiring
/**
 * Headers the API trusts to identify a visitor behind Vercel's /api proxy
 * (see api/Security/ProxyClientIpMiddleware.cs). Only Vercel's routing middleware sets them.
 */
export const PROXY_KEY_HEADER = 'x-mg-proxy-key';
export const CLIENT_IP_HEADER = 'x-mg-client-ip';
/** The rough place of the connection (one decimal place), used by the API for one request and never kept. */
export const CLIENT_LAT_HEADER = 'x-mg-client-lat';
export const CLIENT_LON_HEADER = 'x-mg-client-lon';

/** A rough position: latitude and longitude as plain numbers. */
export interface RoughPlace {
  latitude: string;
  longitude: string;
}

/**
 * The rough place of a visitor from Vercel's own geolocation headers (`x-vercel-ip-latitude` and `-longitude`),
 * rounded to one decimal place (about 11 km). Anything that isn't a real place gives nothing.
 */
export function roughPlaceFrom(headers: Pick<Headers, 'get'>): RoughPlace | undefined {
  const lat = Number.parseFloat(headers.get('x-vercel-ip-latitude') ?? '');
  const lon = Number.parseFloat(headers.get('x-vercel-ip-longitude') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { latitude: lat.toFixed(1), longitude: lon.toFixed(1) };
}

/**
 * The request headers to forward to the API: the original ones, with the visitor's IP and the shared
 * proxy key added, and the rough place when there is one. Anything a browser sent under these names is
 * dropped first, so it can't be forged. Without a key nothing is added (and the place travels only with
 * the key, never alone), and the API treats the request as before.
 */
export function proxyRequestHeaders(
  original: Headers, clientIp: string | undefined, key: string | undefined, place?: RoughPlace,
): Headers {
  const headers = new Headers(original);
  headers.delete(PROXY_KEY_HEADER);
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(CLIENT_LAT_HEADER);
  headers.delete(CLIENT_LON_HEADER);
  if (key && clientIp) {
    headers.set(PROXY_KEY_HEADER, key);
    headers.set(CLIENT_IP_HEADER, clientIp);
    if (place) {
      headers.set(CLIENT_LAT_HEADER, place.latitude);
      headers.set(CLIENT_LON_HEADER, place.longitude);
    }
  }
  return headers;
}
