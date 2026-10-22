/// <reference types="node" />
// Vercel Routing Middleware. It does two jobs.
//
// 1. /api/*: runs before the rewrite to the API project in vercel.json and passes the visitor's IP with a
//    shared key, so the API can apply rate limits per visitor rather than to everyone arriving from Vercel.
//    Set MG_PROXY_KEY here and Security__ProxyKey on the API project to the same random value; without it
//    nothing is added and the API behaves as before.
// 2. Competition, team-profile and home pages: when a link-preview crawler (WhatsApp, Facebook, iMessage,
//    Slack and so on) asks for one, answer with a small page carrying the Open Graph tags instead of the
//    app, because those crawlers don't run JavaScript. Everyone else gets the app, untouched.
import { ipAddress, next } from '@vercel/functions';
// Vercel runs this as Node ES modules without bundling, so relative imports need the .js extension.
import { proxyRequestHeaders } from './src/lib/proxyHeaders.js';
import {
  competitionCard, genericCard, isPreviewCrawler, readCompetition, readTeamProfile, renderCardPage,
  shareApiPath, sharePageFor, teamProfileCard,
  type ShareCard, type SharePage,
} from './src/lib/shareCard.js';

export const config = { matcher: ['/api/:path*', '/', '/competitions/:path*', '/team-profiles/:path*'] };

/** The API project. Override with MG_API_ORIGIN (for example on a preview deployment). */
const DEFAULT_API_ORIGIN = 'https://mounted-games-api.vercel.app';
const API_TIMEOUT_MS = 3000;

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    return next({ request: { headers: proxyRequestHeaders(request.headers, ipAddress(request), process.env.MG_PROXY_KEY) } });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return next();
  if (!isPreviewCrawler(request.headers.get('user-agent'))) return next();
  const page = sharePageFor(url.pathname);
  if (!page) return next();

  let card: ShareCard | null = null;
  try {
    card = await loadCard(page, url, request);
  } catch {
    // The API was slow or down: fall through to the app, which shows the generic preview it always had.
  }
  if (!card) return next();

  return new Response(request.method === 'HEAD' ? null : renderCardPage(card), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Kept out of shared caches: the same address gives the app to people and this page to crawlers.
      'Cache-Control': 'private, max-age=300',
      Vary: 'User-Agent',
      'X-Content-Type-Options': 'nosniff',
      // The page has no script or style of its own, so it can be locked right down.
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

async function loadCard(page: SharePage, url: URL, request: Request): Promise<ShareCard | null> {
  if (page.kind === 'generic') return genericCard(url.origin, url.pathname);

  const apiPath = shareApiPath(page);
  if (!apiPath) return null;
  const origin = (process.env.MG_API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/+$/, '');
  // Only the visitor-IP headers go to the API: nothing from the crawler's own request.
  const headers = proxyRequestHeaders(new Headers(), ipAddress(request), process.env.MG_PROXY_KEY);
  headers.set('Accept', 'application/json');
  const response = await fetch(`${origin}${apiPath}`, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!response.ok) return null;
  const body: unknown = await response.json();

  if (page.kind === 'competition') {
    const data = readCompetition(body);
    return data ? competitionCard(data, url.origin, page.id) : null;
  }
  const data = readTeamProfile(body);
  return data ? teamProfileCard(data, url.origin, page.id) : null;
}
