import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, defaultTimetableDay } from '../src/lib/timetableDay.ts';

test('opens today when it is a competition day', () => {
  assert.equal(defaultTimetableDay(['2026-06-08', '2026-06-06', '2026-06-07'], '2026-06-07'), '2026-06-07');
});

test('opens the next scheduled day before or between competition days', () => {
  assert.equal(defaultTimetableDay(['2026-06-08', '2026-06-06'], '2026-06-07'), '2026-06-08');
});

test('opens the last day for a past competition and handles an empty timetable', () => {
  assert.equal(defaultTimetableDay(['2026-06-08', '2026-06-06'], '2026-06-09'), '2026-06-08');
  assert.equal(defaultTimetableDay([], '2026-06-09'), '2026-06-09');
});

test('uses the local calendar date at midnight, rather than the UTC date', () => {
  assert.equal(dayKey(new Date(2026, 5, 7, 0, 1)), '2026-06-07');
  assert.equal(dayKey(new Date('invalid')), '');
});
