import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCachePublicApi, EMBED_REQUEST_HEADER, isEmbedRequest, markSavedResponse, NAVIGATION_DENYLIST, stampPublicResponse } from '../src/offline/cachePolicy.ts';

test('only public competition reads and reference data can be cached', () => {
  for (const path of ['/api/competitions', '/api/competitions/42', '/api/competitions/42/standings', '/api/weather/at', '/api/race-templates']) assert.equal(canCachePublicApi(path), true, path);
  for (const path of ['/api/competitions/42/signups', '/api/competitions/42/signups-locked', '/api/auth/me', '/api/me/signups', '/api/declaration-forms', '/api/trainer/my-teams', '/api/shop', '/api/competitions/42/chat', '/api/unknown']) assert.equal(canCachePublicApi(path), false, path);
});

test('writes never use cached public responses', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal(canCachePublicApi('/api/competitions/42', method), false);
});

test('the lightweight picker is cacheable but its writes and unrelated routes are not', () => {
  assert.equal(canCachePublicApi('/api/competitions/picker'), true);
  assert.equal(canCachePublicApi('/api/competitions/picker', 'POST'), false);
  assert.equal(canCachePublicApi('/api/competitions/picker/private'), false);
});

test('saved responses carry a timestamp and a saved-copy marker without changing the live response', async () => {
  const original = Response.json({ name: 'Example competition' });
  const stored = await stampPublicResponse(original);
  assert.ok(stored.headers.get('x-mg-saved-at'));
  assert.equal(original.headers.get('x-mg-saved-at'), null);
  const fallback = markSavedResponse(stored);
  assert.equal(fallback.headers.get('x-mg-saved-copy'), '1');
  assert.deepEqual(await fallback.json(), { name: 'Example competition' });
  assert.deepEqual(await original.json(), { name: 'Example competition' });
});

test('errors, opaque responses and HTML proxy errors cannot replace a saved timetable', async () => {
  for (const response of [new Response('missing', { status: 404 }), new Response('failed', { status: 500 }), new Response('<html>wrong route</html>', { headers: { 'content-type': 'text/html' } })]) assert.equal(await stampPublicResponse(response), null);
  assert.equal(markSavedResponse(undefined), undefined);
});

test('requests from the embedded widget are recognised by their header and nothing else', () => {
  assert.equal(EMBED_REQUEST_HEADER, 'X-MG-Embed');
  assert.equal(isEmbedRequest(new Headers({ 'X-MG-Embed': '1' })), true);
  assert.equal(isEmbedRequest(new Headers({ 'x-mg-embed': '1' })), true);
  for (const headers of [{}, { 'X-MG-Embed': '0' }, { 'X-MG-Embed': 'true' }, { 'X-MG-Embed': '' }, { 'X-MG-Embed': '1, 1' }, { Accept: 'application/json' }]) assert.equal(isEmbedRequest(new Headers(headers)), false, JSON.stringify(headers));
});

test('the same public read is cacheable for the app but the embed header keeps the widget out of the cache', () => {
  // The service worker route is: same origin, canCachePublicApi(path, method) and not isEmbedRequest(headers).
  const wouldCache = (path, headers) => canCachePublicApi(path) && !isEmbedRequest(new Headers(headers));
  for (const path of ['/api/competitions/42', '/api/competitions/42/standings', '/api/competitions']) {
    assert.equal(wouldCache(path, {}), true, path);
    assert.equal(wouldCache(path, { 'X-MG-Embed': '1' }), false, path);
  }
});

test('the service worker leaves /api, /hubs and /embed navigations to the network', () => {
  const denied = (path) => NAVIGATION_DENYLIST.some((pattern) => pattern.test(path));
  for (const path of ['/api', '/api/competitions', '/hubs/live', '/hubs', '/embed', '/embed/', '/embed/competitions/1/standings', '/embed/seasons/abc/standings']) assert.equal(denied(path), true, path);
  for (const path of ['/', '/competitions/1', '/seasons/abc', '/embedded', '/embedded/x', '/apiary', '/hubspot', '/competitions/embed/1']) assert.equal(denied(path), false, path);
});
