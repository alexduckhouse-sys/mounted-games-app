// Vercel Routing Middleware. It runs before the /api rewrite to the Render API in vercel.json and
// passes the visitor's IP with a shared key, so the API can apply rate limits per visitor rather
// than to everyone arriving from Vercel. Set MG_PROXY_KEY here and Security__ProxyKey on Render to
// the same random value; without it nothing is added and the API behaves as before.
import { ipAddress, next } from '@vercel/functions';
import { proxyRequestHeaders } from './src/lib/proxyHeaders';

export const config = { matcher: '/api/:path*' };

export default function middleware(request: Request) {
  return next({ request: { headers: proxyRequestHeaders(request.headers, ipAddress(request), process.env.MG_PROXY_KEY) } });
}
