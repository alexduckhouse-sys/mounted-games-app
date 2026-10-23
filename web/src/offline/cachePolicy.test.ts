// @vitest-environment node
// These helpers run in the service worker, which has native fetch types (jsdom's Blob does not mix with them).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canCachePublicApi, isEmbedRequest, markSavedResponse, NAVIGATION_DENYLIST, stampPublicResponse } from './cachePolicy';

describe('canCachePublicApi', () => {
  it.each([
    '/api/competitions',
    '/api/competitions/',
    '/api/competitions/picker',
    '/api/competitions/12',
    '/api/competitions/12/standings',
    '/api/race-templates',
    '/api/weather/at',
    '/api/weather/current/',
  ])('allows public GET %s', (path) => {
    expect(canCachePublicApi(path)).toBe(true);
  });

  it.each([
    '/api/competitions/0',
    '/api/competitions/012x',
    '/api/competitions/12/teams',
    '/api/competitions/12/standings/extra',
    '/api/auth/me',
    '/api/weather/forecast',
    '/api/trainer/my-teams',
    '/api/seasons',
    '/api/seasons/synthetic-id',
    '/api/team-profiles/synthetic-id',
    '/api/event-tools/competitions/12/team-import/preview',
    '/api/commerce/orders/mine',
    '/api/commerce/catalogue',
    '/api/commerce/competitions/12/orders',
  ])('refuses %s because it may differ per viewer', (path) => {
    expect(canCachePublicApi(path)).toBe(false);
  });

  it('refuses anything other than GET', () => {
    expect(canCachePublicApi('/api/competitions', 'POST')).toBe(false);
    expect(canCachePublicApi('/api/competitions', 'get')).toBe(false);
  });
});

describe('stampPublicResponse', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('copies a JSON 200 with the time it was saved', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T10:00:00Z'));
    const original = new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'x-keep': 'yes' } });
    const stamped = await stampPublicResponse(original);
    expect(stamped).not.toBeNull();
    expect(stamped!.headers.get('X-MG-Saved-At')).toBe('2026-06-01T10:00:00.000Z');
    expect(stamped!.headers.get('x-keep')).toBe('yes');
    expect(await stamped!.json()).toEqual({ a: 1 });
    // The original stays readable for the page.
    expect(await original.json()).toEqual({ a: 1 });
  });

  it('does not store errors or non-JSON responses', async () => {
    expect(await stampPublicResponse(new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }))).toBeNull();
    expect(await stampPublicResponse(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))).toBeNull();
    expect(await stampPublicResponse(new Response('x', { status: 200 }))).toBeNull();
  });
});

describe('markSavedResponse', () => {
  it('flags a saved copy and keeps its status, body and headers', async () => {
    const saved = new Response('{"a":2}', { status: 200, headers: { 'content-type': 'application/json', 'X-MG-Saved-At': 'then' } });
    const marked = markSavedResponse(saved)!;
    expect(marked.headers.get('X-MG-Saved-Copy')).toBe('1');
    expect(marked.headers.get('X-MG-Saved-At')).toBe('then');
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({ a: 2 });
  });

  it('returns undefined when nothing was saved', () => {
    expect(markSavedResponse(undefined)).toBeUndefined();
  });
});

describe('embed requests and navigation', () => {
  it('recognises the widget header' , () => {
    expect(isEmbedRequest(new Headers({ 'X-MG-Embed': '1' }))).toBe(true);
    expect(isEmbedRequest(new Headers())).toBe(false);
    expect(isEmbedRequest(new Headers({ 'X-MG-Embed': '0' }))).toBe(false);
  });

  it.each([{ 'X-MG-Embed': 'true' }, { 'X-MG-Embed': '' }, { 'X-MG-Embed': '1, 1' }])('only the exact value 1 counts, not %j', (headers) => {
    expect(isEmbedRequest(new Headers(headers))).toBe(false);
  });

  it('keeps the widget out of the cache that serves the same public reads to the app', () => {
    // The service worker's cached route is: same origin, canCachePublicApi(path, method) and not isEmbedRequest(headers).
    const wouldCache = (path: string, headers: Record<string, string>) => canCachePublicApi(path) && !isEmbedRequest(new Headers(headers));
    for (const path of ['/api/competitions', '/api/competitions/42', '/api/competitions/42/standings']) {
      expect(wouldCache(path, {})).toBe(true);
      expect(wouldCache(path, { 'X-MG-Embed': '1' })).toBe(false);
    }
  });

  it('leaves the API, the hub and /embed/ pages to the network', () => {
    const denied = (path: string) => NAVIGATION_DENYLIST.some((rule) => rule.test(path));
    for (const path of ['/api/x', '/hubs/live', '/embed/competitions/1/standings', '/embed']) expect(denied(path)).toBe(true);
    for (const path of ['/', '/competitions/1', '/embedded', '/competitions/embed/x']) expect(denied(path)).toBe(false);
  });
});
