import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTimings, roundTo5Min, formatTime } from '../src/lib/time.ts';

const date = (time) => new Date(`2026-06-01T${time}:00Z`);
const iso = (time) => date(time).toISOString();
const heat = (id, extra = {}) => ({ id, orderIndex: id, races: [], ...extra });
const session = (id, extra = {}) => ({ id, orderIndex: id, kind: 0, heats: [], ...extra });
const at = (actual, expected) => assert.equal(actual?.toISOString(), iso(expected));

test('rounds time either side of a five-minute midpoint and preserves missing times', () => {
  at(roundTo5Min(new Date('2026-06-01T09:02:29Z')), '09:00');
  at(roundTo5Min(new Date('2026-06-01T09:02:30Z')), '09:05');
  assert.equal(roundTo5Min(null), null);
  assert.equal(formatTime(null), '—');
  assert.equal(formatTime(date('09:00')), date('09:00').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
});

test('empty timetables and sessions without a time remain unscheduled', () => {
  assert.equal(computeTimings([]).size, 0);
  const result = computeTimings([session(1, { heats: [heat(1)] })]).get(1);
  assert.equal(result.effective, null);
  assert.equal(result.effectiveEnd, null);
  assert.equal(result.heats[0].effective, null);
});

test('orders sessions and heats without mutating the source arrays', () => {
  const heats = [heat(2), heat(1)];
  const sessions = [session(2), session(1, { scheduledStart: iso('09:00'), heats })];
  const result = computeTimings(sessions);
  assert.deepEqual([...result.keys()], [1, 2]);
  assert.deepEqual(result.get(1).heats.map((h) => h.heatId), [1, 2]);
  assert.deepEqual(heats.map((h) => h.id), [2, 1]);
  assert.deepEqual(sessions.map((s) => s.id), [2, 1]);
});

test('explicit heat duration takes precedence over per-race duration and the default', () => {
  const result = computeTimings([session(1, { scheduledStart: iso('09:00'), minutesPerHeat: 4, heats: [heat(1, { durationMinutes: 10, races: [{}, {}] }), heat(2, { races: [{}, {}] }), heat(3)] })]).get(1);
  at(result.heats[1].effective, '09:10');
  at(result.heats[2].effective, '09:18');
  at(result.effectiveEnd, '09:22');
});

test('default heat duration is 30 minutes when no duration is configured', () => {
  const result = computeTimings([session(1, { scheduledStart: iso('09:00'), heats: [heat(1), heat(2)] })]).get(1);
  at(result.heats[1].effective, '09:30');
  at(result.effectiveEnd, '10:00');
});

test('a late session shifts later sessions while preserving advertised times', () => {
  const result = computeTimings([session(1, { scheduledStart: iso('09:00'), startedAt: iso('09:15'), heats: [heat(1)] }), session(2, { scheduledStart: iso('10:00') })]);
  at(result.get(2).scheduled, '10:00');
  at(result.get(2).effective, '10:15');
  assert.equal(result.get(2).shifted, true);
});

test('an early session cannot pull the next session before the previous finish', () => {
  const result = computeTimings([session(1, { scheduledStart: iso('09:00'), startedAt: iso('08:50'), heats: [heat(1)] }), session(2, { scheduledStart: iso('09:10') }), session(3, { scheduledStart: iso('10:00') })]);
  at(result.get(2).effective, '09:20');
  at(result.get(3).effective, '10:10');
});

test('a session with no advertised start follows the previous session', () => {
  const result = computeTimings([session(1, { scheduledStart: iso('09:00'), durationMinutes: 20 }), session(2)]);
  at(result.get(2).effective, '09:20');
  assert.equal(result.get(2).scheduled, null);
});

test('breaks, briefings and custom sessions use their own duration', () => {
  for (const kind of [1, 2, 3]) {
    const result = computeTimings([session(1, { kind, scheduledStart: iso('09:00'), durationMinutes: 15, heats: [heat(1)] })]).get(1);
    at(result.effectiveEnd, '09:15');
    at(computeTimings([session(1, { kind, scheduledStart: iso('09:00') })]).get(1).effectiveEnd, '09:00');
  }
});

test('a pinned heat sets the next heat’s scheduled and effective start', () => {
  const result = computeTimings([session(1, { scheduledStart: iso('09:00'), heats: [heat(1, { scheduledStart: iso('10:00') }), heat(2)] })]).get(1);
  at(result.heats[0].effective, '10:00');
  at(result.heats[1].scheduled, '10:30');
  at(result.heats[1].effective, '10:30');
});

test('an actual heat start takes precedence over its pinned start', () => {
  const result = computeTimings([session(1, { heats: [heat(1, { scheduledStart: iso('09:00'), startedAt: iso('09:10') })] })]).get(1);
  at(result.heats[0].effective, '09:10');
  assert.equal(result.heats[0].shifted, true);
});

test('five minutes is the shift boundary for existing management time chips', () => {
  for (const [startedAt, shifted] of [[iso('09:04'), false], [iso('09:05'), true]]) {
    const result = computeTimings([session(1, { scheduledStart: iso('09:00'), startedAt, heats: [heat(1)] })]).get(1);
    assert.equal(result.shifted, shifted);
    assert.equal(result.heats[0].shifted, shifted);
  }
});

test('an actual session start works without an advertised start or heats field', () => {
  const result = computeTimings([session(1, { startedAt: iso('09:00'), heats: undefined })]).get(1);
  at(result.effective, '09:00');
  assert.deepEqual(result.heats, []);
  assert.equal(result.shifted, false);
});
