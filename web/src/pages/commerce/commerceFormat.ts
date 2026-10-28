import { tr } from '../../i18n/translate';
import { lineTitle } from '../../lib/shopOptions';
import type { CommerceItemCategory } from './types';

export const CATEGORY_LABEL: Record<CommerceItemCategory, string> = {
  get 0() { return tr('site.shop.catMerchandise'); },
  get 1() { return tr('site.shop.catTickets'); },
  get 2() { return tr('site.shop.catCamping'); },
  get 3() { return tr('site.shop.catOther'); },
};

export function pounds(minor: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(minor / 100);
}

/** "Hoodie · M × 2", with what the buyer answered after it: "Shavings × 2 (B12)". */
export function orderLineText(line: { title: string; optionLabel?: string | null; quantity: number; detail?: string | null }): string {
  const detail = line.detail?.trim();
  return `${lineTitle(line)} × ${line.quantity}${detail ? ` (${detail})` : ''}`;
}

export function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { message?: string; detail?: string } | string } }).response?.data;
  if (typeof data === 'string') return data;
  return data?.message ?? data?.detail ?? fallback;
}

export function newIdempotencyKey(prefix: string): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}
