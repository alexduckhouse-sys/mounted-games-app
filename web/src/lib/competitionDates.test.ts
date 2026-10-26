import { describe, expect, it } from 'vitest';
import { competitionDateText, isOnToday } from './competitionDates';

// Dates without a zone are local time, which is what the helpers format in.
describe('competitionDateText', () => {
  it('writes a single day', () => {
    expect(competitionDateText('2026-10-17T10:00:00')).toBe('Sat 17 Oct');
    expect(competitionDateText('2026-10-17T10:00:00', '2026-10-17T18:00:00')).toBe('Sat 17 Oct');
  });

  it('writes a range inside one month with the month once', () => {
    expect(competitionDateText('2026-10-17T10:00:00', '2026-10-18T10:00:00')).toBe('Sat 17 – Sun 18 Oct');
  });

  it('writes both months when the range crosses a month', () => {
    expect(competitionDateText('2026-10-31T10:00:00', '2026-11-01T10:00:00')).toBe('Sat 31 Oct – Sun 1 Nov');
  });

  it('writes both months when the same month falls in different years', () => {
    expect(competitionDateText('2026-12-31T10:00:00', '2027-01-01T10:00:00', true)).toBe('Thu 31 Dec – Fri 1 Jan 2027');
    expect(competitionDateText('2026-10-17T10:00:00', '2027-10-18T10:00:00')).toBe('Sat 17 Oct – Mon 18 Oct');
  });

  it('adds the year on request, using the end date', () => {
    expect(competitionDateText('2026-10-17T10:00:00', null, true)).toBe('Sat 17 Oct 2026');
    expect(competitionDateText('2026-10-17T10:00:00', '2026-10-18T10:00:00', true)).toBe('Sat 17 – Sun 18 Oct 2026');
  });

  it('shows only the start when the end is before it, blank or unreadable', () => {
    expect(competitionDateText('2026-10-18T10:00:00', '2026-10-17T10:00:00')).toBe('Sun 18 Oct');
    expect(competitionDateText('2026-10-17T10:00:00', '')).toBe('Sat 17 Oct');
    expect(competitionDateText('2026-10-17T10:00:00', 'soon')).toBe('Sat 17 Oct');
  });

  it('returns an empty string when the start is unreadable', () => {
    expect(competitionDateText('not a date')).toBe('');
  });

  it('keeps date-only, UTC midnight, and BST midnight strings on the right UK calendar day', () => {
    expect(competitionDateText('2026-10-17', '2026-10-18')).toBe('Sat 17 – Sun 18 Oct');
    expect(competitionDateText('2026-10-17T00:00:00Z', '2026-10-18T00:00:00Z')).toBe('Sat 17 – Sun 18 Oct');
    expect(competitionDateText('2026-10-16T23:00:00Z', '2026-10-17T23:00:00Z')).toBe('Sat 17 – Sun 18 Oct');
  });
});

describe('isOnToday', () => {
  const now = new Date(2026, 9, 17, 15, 30);

  it('includes the first and last day', () => {
    expect(isOnToday('2026-10-17T00:00:00', '2026-10-18T00:00:00', now)).toBe(true);
    expect(isOnToday('2026-10-16T09:00:00', '2026-10-17T09:00:00', now)).toBe(true);
    expect(isOnToday('2026-10-16T09:00:00', '2026-10-19T09:00:00', now)).toBe(true);
  });

  it('is false before the start and after the end', () => {
    expect(isOnToday('2026-10-18T00:00:00', '2026-10-19T00:00:00', now)).toBe(false);
    expect(isOnToday('2026-10-14T00:00:00', '2026-10-16T00:00:00', now)).toBe(false);
  });

  it('treats a missing or unreadable end as a one-day competition', () => {
    expect(isOnToday('2026-10-17T08:00:00', null, now)).toBe(true);
    expect(isOnToday('2026-10-17T08:00:00', undefined, now)).toBe(true);
    expect(isOnToday('2026-10-17T08:00:00', 'soon', now)).toBe(true);
    expect(isOnToday('2026-10-16T08:00:00', null, now)).toBe(false);
  });

  it('is false when the start is unreadable', () => {
    expect(isOnToday('soon', '2026-10-18T00:00:00', now)).toBe(false);
  });
});
