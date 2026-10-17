import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describePlacings, discard, enqueue, nextToSend, outcomeOfError, overrule, placingsOf, retry, settle,
} from '../src/offline/scoreOutbox.ts';

const item = (raceId, extra = {}) => ({
  raceId, competitionId: 1, sessionId: 2, label: `Heat 1 · Race ${raceId}`,
  places: [{ teamId: 10, place: 1, eliminated: false }],
  expected: [], teamNames: { 10: 'Red', 11: 'Blue' },
  queuedAt: `2026-10-15T10:00:0${raceId}Z`, state: 'waiting', ...extra,
});
const heatWith = (raceId, results) => ({ id: 5, sessionId: 2, orderIndex: 0, entries: [], races: [{ id: raceId, results }] });

test('a new save for the same race replaces the waiting one and keeps order', () => {
  const list = enqueue(enqueue([item(1)], item(2)), item(1, { queuedAt: 'later' }));
  assert.deepEqual(list.map((q) => [q.raceId, q.queuedAt]), [[2, '2026-10-15T10:00:02Z'], [1, 'later']]);
});

test('sends the oldest waiting save, skipping ones that need a decision', () => {
  assert.equal(nextToSend([item(1, { state: 'conflict' }), item(2), item(3)]).raceId, 2);
  assert.equal(nextToSend([item(1, { state: 'failed' })]), undefined);
});

test('a saved result leaves the outbox; no signal keeps it waiting', () => {
  const list = [item(1), item(2)];
  assert.deepEqual(settle(list, list[0], { kind: 'saved', sessionId: 2, heat: heatWith(1, []) }).map((q) => q.raceId), [2]);
  assert.equal(settle(list, list[0], { kind: 'offline' }), list);
});

test('a save re-scored while in flight is not removed when the old one lands', () => {
  const sent = item(1);
  const list = enqueue([sent], item(1, { queuedAt: 'newer' }));
  assert.deepEqual(settle(list, sent, { kind: 'saved', sessionId: 2, heat: heatWith(1, []) }), list);
});

test('a conflict keeps both sets of results; "use mine" resends against theirs', () => {
  const theirs = [{ id: 1, teamId: 11, teamName: 'Blue', placing: 1, eliminated: false, points: 2 },
    { id: 2, teamId: 10, teamName: 'Red', placing: null, eliminated: true, points: 0 }];
  const [conflicted] = settle([item(1)], item(1), { kind: 'conflict', sessionId: 2, heat: heatWith(1, theirs) });
  assert.equal(conflicted.state, 'conflict');
  assert.deepEqual(conflicted.theirs, [{ teamId: 11, place: 1, eliminated: false }, { teamId: 10, place: 0, eliminated: true }]);
  const [resend] = overrule([conflicted], 1);
  assert.equal(resend.state, 'waiting');
  assert.deepEqual(resend.expected, conflicted.theirs);
  assert.deepEqual(discard([conflicted], 1), []);
});

test('a refused save waits for the scorer, then can be retried', () => {
  const [failed] = settle([item(1)], item(1), { kind: 'failed', message: 'nope' });
  assert.deepEqual([failed.state, failed.error], ['failed', 'nope']);
  assert.deepEqual([retry([failed], 1)[0].state, retry([failed], 1)[0].error], ['waiting', undefined]);
});

test('classifies request errors', () => {
  const res = (status, data) => ({ isAxiosError: true, response: { status, data } });
  assert.equal(outcomeOfError({ isAxiosError: true, code: 'ERR_NETWORK' }).kind, 'offline');
  assert.equal(outcomeOfError(res(502)).kind, 'offline', 'a waking or failing server is retried later');
  assert.equal(outcomeOfError(res(409, { sessionId: 2, heat: heatWith(1, []) })).kind, 'conflict');
  assert.equal(outcomeOfError(res(401)).kind, 'failed');
  assert.equal(outcomeOfError(res(400, { message: 'Bad places' })).message, 'Bad places');
});

test('describes placings for people', () => {
  const names = { 1: 'Red', 2: 'Blue', 3: 'Green' };
  assert.equal(describePlacings([
    { teamId: 3, place: 3, eliminated: true }, { teamId: 2, place: 2, eliminated: false }, { teamId: 1, place: 1, eliminated: false },
  ], names), '1st Red · 2nd Blue · Green out');
  assert.equal(describePlacings([], names), 'No results');
  assert.deepEqual(placingsOf([{ id: 1, teamId: 4, teamName: 'X', placing: 11, eliminated: false, points: 1 }]), [{ teamId: 4, place: 11, eliminated: false }]);
});
