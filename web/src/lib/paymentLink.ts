export const PAYMENT_LINK_URL_MAX = 500;

const HTTPS_URL_IN_TEXT_RE = /https:\/\/[^\s<>"')]+/i;
const TRAILING_PUNCTUATION_RE = /[.,;:)\]+!?]+$/;

/**
 * Normalises an optional external payment link (Stripe Payment Link, SumUp, PayPal, etc.).
 * Blank strings return `null`. Non-blank strings must be valid `https://` URLs up to 500 characters.
 */
export function normalisePaymentLinkUrl(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.length > PAYMENT_LINK_URL_MAX) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol.toLowerCase() !== 'https:' || !parsed.hostname) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Returns `true` when `value` is blank/null or a valid `https://` payment link URL within 500 characters.
 */
export function isValidPaymentLinkUrl(value?: string | null): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return true;
  return normalisePaymentLinkUrl(trimmed) !== null;
}

/**
 * Extracts the first valid `https://` URL from free-text payment instructions (`paymentDestination`).
 */
export function extractHttpsUrlFromText(text?: string | null): string | null {
  if (!text) return null;
  const match = HTTPS_URL_IN_TEXT_RE.exec(text);
  if (!match) return null;
  const candidate = match[0].replace(TRAILING_PUNCTUATION_RE, '');
  return normalisePaymentLinkUrl(candidate);
}

/**
 * Returns the competition's dedicated `paymentLinkUrl`, or falls back to an `https://` link
 * embedded inside `paymentDestination`.
 */
export function resolvePaymentLinkUrl(
  source?: { paymentLinkUrl?: string | null; paymentDestination?: string | null } | null,
): string | null {
  if (!source) return null;
  return (
    normalisePaymentLinkUrl(source.paymentLinkUrl) ??
    extractHttpsUrlFromText(source.paymentDestination)
  );
}

/**
 * Identifies a human-friendly payment provider name from an `https://` payment link URL.
 */
export function paymentProviderLabel(url?: string | null): string {
  const normalised = normalisePaymentLinkUrl(url);
  if (!normalised) return 'Card / Apple Pay';
  const host = new URL(normalised).hostname.toLowerCase();
  if (host === 'stripe.com' || host.endsWith('.stripe.com')) return 'Stripe';
  if (host === 'sumup.com' || host.endsWith('.sumup.com') || host === 'sumup.io' || host.endsWith('.sumup.io')) {
    return 'SumUp';
  }
  if (host === 'paypal.com' || host.endsWith('.paypal.com') || host === 'paypal.me' || host.endsWith('.paypal.me')) {
    return 'PayPal';
  }
  if (host === 'square.link' || host.endsWith('.square.link') || host.endsWith('.squareup.com')) {
    return 'Square';
  }
  return 'Card / Apple Pay';
}

/**
 * Standard button copy for paying online by card or Apple Pay.
 */
export function paymentLinkCtaLabel(): string {
  return 'Pay Online by Card / Apple Pay →';
}
