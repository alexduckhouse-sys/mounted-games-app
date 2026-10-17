import type { CommerceItemCategory, CommerceListingStatus, CommerceOrderStatus } from './types';

export const CATEGORY_LABEL: Record<CommerceItemCategory, string> = {
  0: 'Merchandise',
  1: 'Tickets',
  2: 'Camping',
  3: 'Other',
};

export const LISTING_LABEL: Record<CommerceListingStatus, string> = {
  0: 'Waiting for approval',
  1: 'Approved',
  2: 'Not approved',
  3: 'Withdrawn',
};

export const ORDER_LABEL: Record<CommerceOrderStatus, string> = {
  0: 'Pay the organiser',
  1: 'Demo payment due',
  2: 'Paid',
  3: 'Test payment declined',
  4: 'Cancelled',
  5: 'Refunded',
};

export function pounds(minor: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(minor / 100);
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
