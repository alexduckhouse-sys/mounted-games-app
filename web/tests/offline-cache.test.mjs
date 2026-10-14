import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCachePublicApi, markSavedResponse, stampPublicResponse } from '../src/offline/cachePolicy.ts';

test('only public competition reads and reference data can be cached', () => {
  for (const path of ['/api/competitions', '/api/competitions/42', '/api/competitions/42/standings', '/api/weather/at', '/api/race-templates']) assert.equal(canCachePublicApi(path), true, path);
  for (const path of ['/api/competitions/42/signups', '/api/competitions/42/signups-locked', '/api/auth/me', '/api/me/signups', '/api/declaration-forms', '/api/trainer/my-teams', '/api/shop', '/api/competitions/42/chat', '/api/unknown']) assert.equal(canCachePublicApi(path), false, path);
});

test('writes never use cached public responses', () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal(canCachePublicApi('/api/competitions/42', method), false);
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
