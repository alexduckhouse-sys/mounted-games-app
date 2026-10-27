import type { EmailDeliveryStatus } from '../types';

/**
 * The sentence shown beside the new-competition email box. The API stores which version the person saw
 * (`EmailOptInWording` in `api/Services/Email/EmailOptInService.cs`), so change the text and the version
 * together, in both places.
 */
export const EMAIL_OPT_IN_VERSION = 'alerts-2026-10-22';
export const EMAIL_OPT_IN_TEXT = 'Email me when new competitions open. I can unsubscribe at any time.';

/** One id per submit of the form, so a retry after a dropped connection can't enter someone twice. */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Light client-side check before the server validates the address. */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /\s/.test(trimmed)) return false;
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/** What an organiser sees about the entry confirmation email. */
export function confirmationEmailLabel(status: EmailDeliveryStatus | undefined, hasAddress: boolean): string {
  if (!hasAddress) return 'No email address';
  switch (status) {
    case 1: return 'Confirmation emailed';
    case 2: return 'Confirmation email failed';
    case 3: return 'Confirmation not sent (email is off)';
    default: return 'Confirmation not sent';
  }
}
