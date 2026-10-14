import test from 'node:test';
import assert from 'node:assert/strict';
import { timetableRows, timetableStatus } from '../src/lib/timetableRows.ts';

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
