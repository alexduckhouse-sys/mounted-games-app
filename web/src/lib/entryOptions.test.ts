import { describe, expect, it } from 'vitest';
import { entryOptions, feesLine, feeText, needsPayStep, parseEntryKind, remainingPlaces, sectionFull } from './entryOptions';

describe('remainingPlaces', () => {
  it('uses admission places rather than a count of teams already formed', () => {
    expect(remainingPlaces({ maxParticipants: 10, activeSignupsCount: 4 })).toBe(6);
    expect(remainingPlaces({ maxParticipants: 10, activeSignupsCount: 0 })).toBe(10);
    expect(remainingPlaces({ maxParticipants: 10, activeSignupsCount: 10 })).toBe(0);
    expect(remainingPlaces({ maxParticipants: 10, activeSignupsCount: 12 })).toBe(0);
  });
  it('does not invent availability when the cap or count is absent or invalid', () => {
    expect(remainingPlaces({})).toBeNull();
    expect(remainingPlaces({ maxParticipants: 10 })).toBeNull();
    expect(remainingPlaces({ maxParticipants: null, activeSignupsCount: 3 })).toBeNull();
    for (const maxParticipants of [0, -1, NaN, Infinity, 2.5]) {
      expect(remainingPlaces({ maxParticipants, activeSignupsCount: 1 })).toBeNull();
    }
    for (const activeSignupsCount of [-1, NaN, Infinity, 2.5]) {
      expect(remainingPlaces({ maxParticipants: 10, activeSignupsCount })).toBeNull();
    }
  });
});

describe('feeText', () => {
  it.each([
    [0, 'Free'], [null, 'Free'], [undefined, 'Free'], [-5, 'Free'],
    [1500, '£15'], [1550, '£15.50'], [5, '£0.05'],
  ])('reads %s as %s', (minor, text) => {
    expect(feeText(minor)).toBe(text);
  });
});

describe('entryOptions', () => {
  it('offers a team or a free guest rider in a teams age group', () => {
    expect(entryOptions({ format: 2, priceMinor: 1500 }).map((o) => [o.kind, o.label, o.priceMinor])).toEqual([
      ['standard', 'Team', 1500], ['guest', 'Guest rider', 0],
    ]);
  });

  it('offers a pair or a solo rider at half the fee in a pairs age group', () => {
    expect(entryOptions({ format: 1, priceMinor: 1001 }).map((o) => [o.kind, o.label, o.priceMinor])).toEqual([
      ['standard', 'Pair', 1001], ['partner', 'Solo rider', 500],
    ]);
  });

  it('offers one individual entry, free when no price is set', () => {
    expect(entryOptions({ format: 3 })).toEqual([{ kind: 'standard', label: 'Individual', priceMinor: 0 }]);
  });

  it('falls back to a plain entry for an unknown format', () => {
    expect(entryOptions({ format: 0 as never, priceMinor: 100 })[0].label).toBe('Entry');
  });

  it('offers the waiting list, and guest riders in teams, once an age group is full', () => {
    expect(entryOptions({ format: 2, priceMinor: 1500 }, true).map((o) => o.kind)).toEqual(['waitlist', 'guest']);
    expect(entryOptions({ format: 3, priceMinor: 1500 }, true).map((o) => o.kind)).toEqual(['waitlist']);
  });
});

describe('feesLine', () => {
  it('puts the fees on one line', () => {
    expect(feesLine({ format: 2, priceMinor: 1500 })).toBe('Team £15 · Guest rider Free');
  });

  it('says an age group is full and names the waiting list', () => {
    expect(feesLine({ format: 2, priceMinor: 1500 }, true)).toBe('Full · Waiting list · Guest rider Free');
  });
});

describe('sectionFull', () => {
  it('is full only when the count is known and has reached the cap', () => {
    expect(sectionFull({ maxParticipants: 4, activeSignupsCount: 4 })).toBe(true);
    expect(sectionFull({ maxParticipants: 4, activeSignupsCount: 3 })).toBe(false);
    expect(sectionFull({ maxParticipants: 4 })).toBe(false);
    expect(sectionFull({ maxParticipants: null, activeSignupsCount: 9 })).toBe(false);
  });
});

describe('parseEntryKind and needsPayStep', () => {
  it('accepts only the four kinds', () => {
    expect(parseEntryKind('guest')).toBe('guest');
    expect(parseEntryKind('standard')).toBe('standard');
    expect(parseEntryKind('nonsense')).toBeNull();
    expect(parseEntryKind(null)).toBeNull();
  });

  it('only asks for a pay step when there is something to pay', () => {
    expect(needsPayStep(0)).toBe(false);
    expect(needsPayStep(1)).toBe(true);
  });
});
