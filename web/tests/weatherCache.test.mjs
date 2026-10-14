import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestCache, forecastHour } from '../src/weather/requestCache.ts';

test('coalesces concurrent calls and reuses weather for 30 minutes', async () => {
  let now = 0;
  let calls = 0;
  const request = createRequestCache(() => now);
  const fetcher = async () => ++calls;
  assert.deepEqual(await Promise.all([request('venue', fetcher), request('venue', fetcher)]), [1, 1]);
  now = 30 * 60_000 - 1;
  assert.equal(await request('venue', fetcher), 1);
  now += 1;
  assert.equal(await request('venue', fetcher), 2);
  assert.equal(await request('other-venue', fetcher), 3);
});

test('briefly backs off failures, then allows a new request', async () => {
  let now = 0;
  let calls = 0;
  const request = createRequestCache(() => now);
  const fetcher = async () => { calls += 1; throw new Error('Example network failure'); };
  await assert.rejects(request('venue', fetcher));
  await assert.rejects(request('venue', fetcher));
  assert.equal(calls, 1);
  now = 60_000;
  await assert.rejects(request('venue', fetcher));
  assert.equal(calls, 2);
});

test('nearby forecast times share the same UTC hour, including timezone offsets', () => {
  assert.equal(forecastHour('2026-06-01T10:35:00+01:00'), forecastHour('2026-06-01T09:05:00Z'));
  assert.notEqual(forecastHour('2026-06-01T09:59:00Z'), forecastHour('2026-06-01T10:00:00Z'));
  assert.equal(forecastHour('invalid'), '');
});

test('bounds the cache and evicts the oldest venue after 128 entries', async () => {
  const request = createRequestCache(() => 0);
  let calls = 0;
  const fetcher = async () => ++calls;
  for (let index = 0; index < 129; index++) await request(`venue-${index}`, fetcher);
  assert.equal(await request('venue-128', fetcher), 129);
  assert.equal(await request('venue-0', fetcher), 130);
});

test('normalises Date objects without changing their original time', () => {
  const original = new Date('2026-06-01T09:35:20Z');
  assert.equal(forecastHour(original), '2026-06-01T09:00:00.000Z');
  assert.equal(original.toISOString(), '2026-06-01T09:35:20.000Z');
});
