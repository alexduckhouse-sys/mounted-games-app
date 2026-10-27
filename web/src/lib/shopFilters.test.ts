import { describe, expect, it } from 'vitest';
import type { ShopPost } from '../types';
import { NO_SHOP_FILTERS, countShopFilters, matchesShopFilters, shopFilterChips } from './shopFilters';

const NOW = new Date('2026-10-27T12:00:00Z').getTime();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
function post(over: Partial<ShopPost> = {}): ShopPost {
  return { id: 1, authorName: 'Sam', title: 'Saddle', body: '', priceMinor: 5000, createdAt: daysAgo(1), isDeleted: false, commentCount: 0, reportCount: 0, ...over };
}

describe('matchesShopFilters', () => {
  it('lets everything through when nothing is set', () => {
    expect(matchesShopFilters(post({ priceMinor: null }), NO_SHOP_FILTERS, NOW)).toBe(true);
    expect(matchesShopFilters(post({ createdAt: daysAgo(400) }), NO_SHOP_FILTERS, NOW)).toBe(true);
  });
  it('keeps to a price band, with the edges in the right band', () => {
    const at = (priceMinor: number | null | undefined, price: 'under25' | 'from25to100' | 'over100' | 'unpriced') => matchesShopFilters(post({ priceMinor }), { ...NO_SHOP_FILTERS, price }, NOW);
    expect(at(2499, 'under25')).toBe(true);
    expect(at(2500, 'under25')).toBe(false);
    expect(at(2500, 'from25to100')).toBe(true);
    expect(at(10000, 'from25to100')).toBe(true);
    expect(at(10001, 'from25to100')).toBe(false);
    expect(at(10001, 'over100')).toBe(true);
    expect(at(10000, 'over100')).toBe(false);
    expect(at(0, 'under25')).toBe(true);
    expect(at(null, 'unpriced')).toBe(true);
    expect(at(undefined, 'unpriced')).toBe(true);
    expect(at(1000, 'unpriced')).toBe(false);
    expect(at(null, 'under25')).toBe(false);
    expect(at(null, 'over100')).toBe(false);
  });
  it('can ask for a photo', () => {
    const filters = { ...NO_SHOP_FILTERS, photoOnly: true };
    expect(matchesShopFilters(post({ imageBase64: 'data:image/jpeg;base64,xx' }), filters, NOW)).toBe(true);
    expect(matchesShopFilters(post({ imageBase64: null }), filters, NOW)).toBe(false);
    expect(matchesShopFilters(post(), filters, NOW)).toBe(false);
  });
  it('limits how long ago something was posted', () => {
    const week = { ...NO_SHOP_FILTERS, posted: 'week' as const };
    const month = { ...NO_SHOP_FILTERS, posted: 'month' as const };
    expect(matchesShopFilters(post({ createdAt: daysAgo(7) }), week, NOW)).toBe(true);
    expect(matchesShopFilters(post({ createdAt: daysAgo(8) }), week, NOW)).toBe(false);
    expect(matchesShopFilters(post({ createdAt: daysAgo(30) }), month, NOW)).toBe(true);
    expect(matchesShopFilters(post({ createdAt: daysAgo(31) }), month, NOW)).toBe(false);
  });
  it('uses the real clock when none is given, and needs every filter to match', () => {
    expect(matchesShopFilters(post({ createdAt: new Date().toISOString() }), { price: 'from25to100', photoOnly: false, posted: 'week' })).toBe(true);
    expect(matchesShopFilters(post({ priceMinor: 5000 }), { price: 'under25', photoOnly: false, posted: 'week' }, NOW)).toBe(false);
  });
});

describe('countShopFilters and shopFilterChips', () => {
  it('counts and names only what is set', () => {
    expect(countShopFilters(NO_SHOP_FILTERS)).toBe(0);
    expect(shopFilterChips(NO_SHOP_FILTERS)).toEqual([]);
    const all = { price: 'over100' as const, photoOnly: true, posted: 'month' as const };
    expect(countShopFilters(all)).toBe(3);
    expect(shopFilterChips(all)).toEqual([
      { key: 'price', label: 'Over £100' },
      { key: 'photoOnly', label: 'With a photo' },
      { key: 'posted', label: 'Past month' },
    ]);
  });
});
