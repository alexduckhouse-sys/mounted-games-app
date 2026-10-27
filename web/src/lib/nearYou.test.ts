import { afterEach, describe, expect, it, vi } from 'vitest';
import { distanceMap, distanceText, EVENTS_SORT_KEY, isNearYouPage, readEventsSort, writeEventsSort } from './nearYou';

afterEach(() => { vi.restoreAllMocks(); });

describe('distanceText', () => {
  it.each([
    [0, 'under 5 miles'],
    [4, 'under 5 miles'],
    [5, 'about 5 miles'],
    [28, 'about 30 miles'],
    [32, 'about 30 miles'],
    [49, 'about 50 miles'],
    [67, 'about 70 miles'],
    [99, 'about 100 miles'],
    [101, 'about 100 miles'],
    [263, 'about 275 miles'],
  ])('says %d miles as "%s"', (miles, text) => {
    expect(distanceText(miles)).toBe(text);
  });

  it('says nothing for a distance that is not one', () => {
    expect(distanceText(Number.NaN)).toBe('');
    expect(distanceText(-3)).toBe('');
    expect(distanceText(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('the remembered order', () => {
  it('is nearest first until "soonest" is chosen, and the choice is kept', () => {
    expect(readEventsSort()).toBe('nearest');
    writeEventsSort('soonest');
    expect(localStorage.getItem(EVENTS_SORT_KEY)).toBe('soonest');
    expect(readEventsSort()).toBe('soonest');
    writeEventsSort('nearest');
    expect(readEventsSort()).toBe('nearest');
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readEventsSort()).toBe('nearest');
    expect(() => writeEventsSort('soonest')).not.toThrow();
  });
});

describe('reading an answer', () => {
  it('only believes a page with items and a hasMore flag', () => {
    expect(isNearYouPage({ items: [], hasMore: false })).toBe(true);
    expect(isNearYouPage({ items: [] })).toBe(false);
    expect(isNearYouPage({ hasMore: true })).toBe(false);
    expect(isNearYouPage('<html>')).toBe(false);
    expect(isNearYouPage(null)).toBe(false);
    expect(isNearYouPage(undefined)).toBe(false);
  });

  it('maps distances by id and skips anything malformed', () => {
    expect(distanceMap({ distances: [{ id: 1, miles: 12 }, { id: 2, miles: 0 }] })).toEqual({ 1: 12, 2: 0 });
    expect(distanceMap({ distances: undefined as never })).toEqual({});
    expect(distanceMap({ distances: [null, { id: 'x', miles: 3 }, { id: 4, miles: '3' }] as never })).toEqual({});
  });
});
