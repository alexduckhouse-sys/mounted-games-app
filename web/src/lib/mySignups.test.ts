import { describe, expect, it } from 'vitest';
import type { MySignup } from '../types';
import { groupSignups, isComingUp } from './mySignups';

const now = new Date(2026, 9, 24, 12, 0);
const entry = (id: number, competitionStart: string): MySignup => ({
  id, competitionId: id, competitionName: `Event ${id}`, competitionStart, competitionSectionId: 1, sectionName: 'Open', fullName: 'A Rider',
  amountMinor: 1800, status: 0, createdAt: '2026-10-01T00:00:00',
});

describe('isComingUp', () => {
  it('counts today, the future and yesterday (a second day), but not earlier', () => {
    expect(isComingUp(new Date(2026, 9, 24, 8, 0).toISOString(), now)).toBe(true);
    expect(isComingUp(new Date(2026, 10, 7).toISOString(), now)).toBe(true);
    expect(isComingUp(new Date(2026, 9, 23, 9, 0).toISOString(), now)).toBe(true);
    expect(isComingUp(new Date(2026, 9, 22, 9, 0).toISOString(), now)).toBe(false);
  });

  it('keeps an entry whose date cannot be read in front of the person', () => {
    expect(isComingUp('whenever', now)).toBe(true);
  });
});

describe('groupSignups', () => {
  it('puts the soonest first under coming up and the latest first under past', () => {
    const grouped = groupSignups([
      entry(1, new Date(2026, 10, 7).toISOString()), entry(2, new Date(2026, 9, 31).toISOString()),
      entry(3, new Date(2026, 8, 1).toISOString()), entry(4, new Date(2026, 9, 10).toISOString()), entry(5, 'whenever'),
    ], now);
    expect(grouped.comingUp.map((s) => s.id)).toEqual([5, 2, 1]);
    expect(grouped.past.map((s) => s.id)).toEqual([4, 3]);
  });
});
