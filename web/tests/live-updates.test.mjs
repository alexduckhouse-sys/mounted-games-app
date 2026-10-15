import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResultsUpdate, isNetworkError, replaceHeat, retryOnNetworkError } from '../src/lib/liveUpdates.ts';

const race = (id, extra = {}) => ({ id, heatId: 10, name: `Race ${id}`, orderIndex: id, isComplete: false, startedAt: null, finishedAt: null, results: [], ...extra });
const heat = (id, races) => ({ id, sessionId: 1, orderIndex: id, entries: [], races });
const competition = () => ({
  id: 7,
  sessions: [
    { id: 1, heats: [heat(10, [race(100), race(101)]), heat(11, [race(110)])] },
    { id: 2, heats: [heat(20, [race(200)])] },
  ],
});

test('a saved heat replaces only that heat', () => {
  const before = competition();
  const saved = heat(10, [race(100, { isComplete: true }), race(101)]);
  const after = applyResultsUpdate(before, { sessionId: 1, heat: saved });
  assert.equal(after.sessions[0].heats[0], saved);
  assert.equal(after.sessions[0].heats[1], before.sessions[0].heats[1]);
  assert.equal(after.sessions[1], before.sessions[1]);
  assert.deepEqual(replaceHeat(before, 1, saved), after);
});

test('a race clock start updates that race without a heat in the payload', () => {
  const before = competition();
  before.sessions[0].heats[0].races[0].finishedAt = '2026-10-15T10:00:00Z';
  const after = applyResultsUpdate(before, { sessionId: 1, raceId: 100, started: '2026-10-15T10:05:00Z' });
  assert.equal(after.sessions[0].heats[0].races[0].startedAt, '2026-10-15T10:05:00Z');
  assert.equal(after.sessions[0].heats[0].races[0].finishedAt, null, 'restarting clears the finish');
  assert.equal(after.sessions[0].heats[0].races[1], before.sessions[0].heats[0].races[1]);
  assert.equal(after.sessions[0].heats[1], before.sessions[0].heats[1]);
});

test('a race clock stop records the finish and keeps the start', () => {
  const before = competition();
  before.sessions[0].heats[1].races[0].startedAt = '2026-10-15T10:05:00Z';
  const after = applyResultsUpdate(before, { sessionId: 1, raceId: 110, finished: '2026-10-15T10:06:30Z' });
  assert.deepEqual(
    [after.sessions[0].heats[1].races[0].startedAt, after.sessions[0].heats[1].races[0].finishedAt],
    ['2026-10-15T10:05:00Z', '2026-10-15T10:06:30Z'],
  );
});

const offline = Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
const refused = Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status: 400 } });

test('only lost connections count as network errors', () => {
  assert.equal(isNetworkError(offline), true);
  assert.equal(isNetworkError(Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' })), true);
  assert.equal(isNetworkError(refused), false);
  assert.equal(isNetworkError(Object.assign(new Error('canceled'), { isAxiosError: true, code: 'ERR_CANCELED' })), false);
  assert.equal(isNetworkError(new TypeError('bug')), false);
});

test('retries a dropped request, then succeeds', async () => {
  const waits = [];
  let calls = 0;
  const result = await retryOnNetworkError(async () => {
    if (++calls < 3) throw offline;
    return 'saved';
  }, { delays: [2_000, 5_000], wait: async (ms) => { waits.push(ms); } });
  assert.equal(result, 'saved');
  assert.deepEqual(waits, [2_000, 5_000]);
});

test('gives up after the last retry, and never retries a server refusal', async () => {
  let calls = 0;
  await assert.rejects(retryOnNetworkError(async () => { calls++; throw offline; }, { delays: [1, 1], wait: async () => {} }), offline);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(retryOnNetworkError(async () => { calls++; throw refused; }, { delays: [1, 1], wait: async () => {} }), refused);
  assert.equal(calls, 1);
});
