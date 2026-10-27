import { describe, expect, it } from 'vitest';
import type { SectionSignup } from '../../types';
import {
  bucketCounts, capacityLines, entriesSummaryText, minorToPounds, poundsToMinor, qrSvgMarkup, reminderHoursLeft, signupBucket, waitlistOfferState,
} from './entryLogic';

const s = (over: Partial<SectionSignup>): SectionSignup => ({ id: 1, competitionSectionId: 1, sectionName: 'Under 12', fullName: 'A', amountMinor: 1000, status: 0, createdAt: '', ...over });

describe('entry buckets', () => {
  it('puts waiting-list and withdrawn entries outside paid and pending', () => {
    expect(signupBucket(s({ status: 1 }))).toBe('paid');
    expect(signupBucket(s({ status: 0 }))).toBe('pending');
    expect(signupBucket(s({ status: 0, isWaitlist: true }))).toBe('waitlist');
    expect(signupBucket(s({ status: 1, isWithdrawn: true }))).toBe('withdrawn');
    expect(signupBucket(s({ status: 2 }))).toBe('withdrawn');
    expect(signupBucket(s({ status: 3 }))).toBe('withdrawn');
  });

  it('counts each bucket', () => {
    const counts = bucketCounts([s({ status: 1 }), s({ id: 2 }), s({ id: 3, isWaitlist: true }), s({ id: 4, status: 3 })]);
    expect(counts).toEqual({ all: 4, paid: 1, pending: 1, waitlist: 1, withdrawn: 1 });
  });
});

describe('reminder cooldown', () => {
  const now = new Date('2031-05-01T12:00:00Z');
  it('is zero when never reminded or long ago', () => {
    expect(reminderHoursLeft(null, now)).toBe(0);
    expect(reminderHoursLeft('nonsense', now)).toBe(0);
    expect(reminderHoursLeft('2031-04-30T10:00:00Z', now)).toBe(0);
  });
  it('rounds up the hours left in the day', () => {
    expect(reminderHoursLeft('2031-05-01T09:30:00Z', now)).toBe(22);
  });
});

describe('waitlist offer', () => {
  const now = new Date('2031-05-01T12:00:00Z');
  it('reports none, open and ran out', () => {
    expect(waitlistOfferState(null, now)).toEqual({ state: 'none' });
    expect(waitlistOfferState('bad', now)).toEqual({ state: 'none' });
    expect(waitlistOfferState('2031-05-01T17:20:00Z', now)).toEqual({ state: 'open', text: '5h 20m left' });
    expect(waitlistOfferState('2031-05-01T12:10:00Z', now)).toEqual({ state: 'open', text: '10m left' });
    expect(waitlistOfferState('2031-05-01T11:00:00Z', now).state).toBe('expired');
  });
});

describe('money text', () => {
  it('turns typed pounds into pence without float rounding', () => {
    expect(poundsToMinor('12')).toBe(1200);
    expect(poundsToMinor('£12.5')).toBe(1250);
    expect(poundsToMinor('0.07')).toBe(7);
    expect(poundsToMinor('1.005')).toBeNull();
    expect(poundsToMinor('abc')).toBeNull();
    expect(minorToPounds(1250)).toBe('12.50');
  });
});

describe('summary and capacity', () => {
  const cap = { competitionId: 1, entriesClosed: false, maxStables: 20, stablesBooked: 8, hookupsBooked: 3, maxHookups: null };
  it('lists stables against the limit and hook-ups with no limit', () => {
    expect(capacityLines(cap)).toEqual(['Stables 8 of 20 booked', 'Hook-ups 3 booked']);
    expect(capacityLines(null)).toEqual([]);
    expect(capacityLines({ competitionId: 1, entriesClosed: false })).toEqual([]);
  });
  it('writes counts only, with no names', () => {
    const text = entriesSummaryText('Spring Open', [s({ status: 1, fullName: 'Ada Lovelace' }), s({ id: 2 })], cap);
    expect(text).toContain('Paid 1 · Pending payment 1');
    expect(text).toContain('Under 12: 2');
    expect(text).toContain('Stables 8 of 20 booked');
    expect(text).not.toContain('Ada');
  });
});

describe('qrSvgMarkup', () => {
  it('draws an svg for a link', () => {
    expect(qrSvgMarkup('https://example.test/x')).toMatch(/^<svg /);
  });
});
