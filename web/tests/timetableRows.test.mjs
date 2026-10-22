import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMaxDelay, groupRowsBySession, isGroupFinished, sessionOrdinals, timetableRows, timetableStatus } from '../src/lib/timetableRows.ts';

const scheduled = new Date('2026-06-01T09:00:00Z');
const delayed = new Date('2026-06-01T09:12:00Z');
const heat = (id, extra = {}) => ({ id, orderIndex: id, races: [], entries: [], ...extra });
const session = (heats, extra = {}) => ({ id: 1, name: 'Example session', orderIndex: 1, kind: 0, status: 0, heats, ...extra });

test('finished and live take precedence over delay, while early starts are not late', () => {
  assert.deepEqual(timetableStatus(true, true, scheduled, delayed), { status: 'finished', delayMinutes: 12 });
  assert.equal(timetableStatus(false, true, scheduled, delayed).status, 'live');
  assert.equal(timetableStatus(false, false, scheduled, delayed).status, 'late');
  assert.equal(timetableStatus(false, false, delayed, scheduled).status, 'on-time');
  assert.equal(timetableStatus(false, false, null, null).status, 'on-time');
});

test('only the first unfinished heat in a running session is live', () => {
  const rows = timetableRows([session([heat(1, { races: [{ isComplete: true }] }), heat(2), heat(3)], { status: 1 })], new Map(), false);
  assert.deepEqual(rows.map((row) => row.status), ['finished', 'live', 'on-time']);
});

test('finished sessions finish every row even when individual heat data is incomplete', () => {
  const rows = timetableRows([session([heat(1), heat(2)], { status: 2 })], new Map(), false);
  assert.ok(rows.every((row) => row.status === 'finished'));
});

test('filtering qualifiers preserves each remaining heat’s own time and finals group', () => {
  const sessions = [session([heat(1, { raceRoundStage: 1 }), heat(2, { raceRoundStage: 2 })])];
  const timings = new Map([[1, { heats: [{ heatId: 1, effective: scheduled }, { heatId: 2, effective: delayed }] }]]);
  const rows = timetableRows(sessions, timings, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].effective, delayed);
  assert.equal(rows[0].group, 'Finals');
  assert.equal(timetableRows(sessions, timings, true).length, 2);
});

test('keeps breaks and sessions awaiting heats in the timetable', () => {
  const rows = timetableRows([session([], { kind: 1, name: 'Example break' }), session([], { id: 2, orderIndex: 2 })], new Map(), false);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.heat === null));
});

test('numbers sessions within each age group and groups rows by session in time order', () => {
  const sessions = [
    session([heat(1), heat(2)], { id: 1, orderIndex: 1, competitionSectionId: 10, sectionName: 'Seniors' }),
    session([heat(3)], { id: 2, orderIndex: 2, competitionSectionId: 20, sectionName: 'Juniors' }),
    session([], { id: 3, orderIndex: 3, kind: 1, name: 'Lunch' }),
    session([heat(4)], { id: 4, orderIndex: 4, competitionSectionId: 10, sectionName: 'Seniors' }),
  ];
  const ordinals = sessionOrdinals(sessions);
  assert.deepEqual([1, 2, 3, 4].map((id) => ordinals.get(id)), [1, 1, undefined, 2]);
  const groups = groupRowsBySession(timetableRows(sessions, new Map(), false));
  assert.deepEqual(groups.map((group) => [group.session.id, group.race, group.rows.length]), [[1, true, 2], [2, true, 1], [3, false, 1], [4, true, 1]]);
});

test('a group is finished only when every row is, and its delay ignores finished rows', () => {
  const row = (status, delayMinutes) => ({ status, delayMinutes });
  assert.equal(isGroupFinished([row('finished', 0), row('finished', 5)]), true);
  assert.equal(isGroupFinished([row('finished', 0), row('live', 0)]), false);
  assert.equal(isGroupFinished([]), false);
  assert.equal(groupMaxDelay([row('finished', 9), row('live', 4), row('late', 6)]), 6);
  assert.equal(groupMaxDelay([row('finished', 9)]), 0);
  assert.equal(groupMaxDelay([]), 0);
});

test('status pills say what is happening in a few words', async () => {
  const { statusLabel } = await import('../src/lib/timetableRows.ts');
  assert.equal(statusLabel('live', 0), 'On now');
  assert.equal(statusLabel('late', 8), '+8 min');
  assert.equal(statusLabel('on-time', 0), 'On time');
  assert.equal(statusLabel('finished', 12), 'Finished');
});
