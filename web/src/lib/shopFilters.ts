import type { ShopPost } from '../types';

/** The ways to narrow the tack and kit list, using only what a listing already holds: price, photo and when it was posted. */
export type PriceBand = 'any' | 'under25' | 'from25to100' | 'over100' | 'unpriced';
export type PostedWithin = 'any' | 'week' | 'month';

export interface ShopFilters {
  price: PriceBand;
  photoOnly: boolean;
  posted: PostedWithin;
}

export const NO_SHOP_FILTERS: ShopFilters = { price: 'any', photoOnly: false, posted: 'any' };

export const PRICE_BANDS: { value: PriceBand; label: string }[] = [
  { value: 'any', label: 'Any price' },
  { value: 'under25', label: 'Under £25' },
  { value: 'from25to100', label: '£25 to £100' },
  { value: 'over100', label: 'Over £100' },
  { value: 'unpriced', label: 'No price listed' },
];

export const POSTED_OPTIONS: { value: PostedWithin; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'week', label: 'Past week' },
  { value: 'month', label: 'Past month' },
];

const DAY_MS = 86_400_000;

function inPriceBand(priceMinor: number | null | undefined, band: PriceBand): boolean {
  if (band === 'any') return true;
  if (priceMinor == null) return band === 'unpriced';
  if (band === 'unpriced') return false;
  if (band === 'under25') return priceMinor < 2500;
  if (band === 'from25to100') return priceMinor >= 2500 && priceMinor <= 10000;
  return priceMinor > 10000;
}

export function matchesShopFilters(post: ShopPost, filters: ShopFilters, now: number = Date.now()): boolean {
  if (!inPriceBand(post.priceMinor, filters.price)) return false;
  if (filters.photoOnly && !post.imageBase64) return false;
  if (filters.posted !== 'any') {
    const days = filters.posted === 'week' ? 7 : 30;
    if (now - new Date(post.createdAt).getTime() > days * DAY_MS) return false;
  }
  return true;
}

export function countShopFilters(filters: ShopFilters): number {
  return (filters.price !== 'any' ? 1 : 0) + (filters.photoOnly ? 1 : 0) + (filters.posted !== 'any' ? 1 : 0);
}

/** One label per filter that is set, for the chips under the search bar. */
export function shopFilterChips(filters: ShopFilters): { key: keyof ShopFilters; label: string }[] {
  const chips: { key: keyof ShopFilters; label: string }[] = [];
  if (filters.price !== 'any') chips.push({ key: 'price', label: PRICE_BANDS.find((band) => band.value === filters.price)?.label ?? '' });
  if (filters.photoOnly) chips.push({ key: 'photoOnly', label: 'With a photo' });
  if (filters.posted !== 'any') chips.push({ key: 'posted', label: POSTED_OPTIONS.find((option) => option.value === filters.posted)?.label ?? '' });
  return chips;
}
