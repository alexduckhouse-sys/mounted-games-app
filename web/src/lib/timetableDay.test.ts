import { describe, expect, it } from 'vitest';
import { dayKey, defaultTimetableDay } from './timetableDay';

describe('dayKey', () => {
  it('formats the local calendar date with zero padding', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('returns an empty key for an invalid date', () => {
    expect(dayKey(new Date('not a date'))).toBe('');
  });
});

describe('defaultTimetableDay', () => {
  it('picks today when the competition is on today', () => {
    expect(defaultTimetableDay(['2026-06-02', '2026-06-01'], '2026-06-01')).toBe('2026-06-01');
  });

  it('picks the next day on the timetable when today has nothing', () => {
    expect(defaultTimetableDay(['2026-06-05', '2026-06-01', '2026-06-05'], '2026-06-03')).toBe('2026-06-05');
  });

  it('falls back to the last day once the competition is over', () => {
    expect(defaultTimetableDay(['2026-06-01', '2026-06-02'], '2026-07-01')).toBe('2026-06-02');
  });

  it('ignores blank keys and falls back to today when there are no days', () => {
    expect(defaultTimetableDay(['', ''], '2026-06-01')).toBe('2026-06-01');
    expect(defaultTimetableDay([], '2026-06-01')).toBe('2026-06-01');
  });
});
