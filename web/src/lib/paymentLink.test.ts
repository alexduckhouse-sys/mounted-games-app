import { describe, expect, it } from 'vitest';
import {
  PAYMENT_LINK_URL_MAX,
  extractHttpsUrlFromText,
  isValidPaymentLinkUrl,
  normalisePaymentLinkUrl,
  paymentLinkCtaLabel,
  paymentProviderLabel,
  resolvePaymentLinkUrl,
} from './paymentLink';

describe('paymentLink', () => {
  it('normalises valid https payment links and rejects non-https or overlong links', () => {
    expect(normalisePaymentLinkUrl(null)).toBeNull();
    expect(normalisePaymentLinkUrl('   ')).toBeNull();
    expect(normalisePaymentLinkUrl('  https://buy.stripe.com/test_123  ')).toBe(
      'https://buy.stripe.com/test_123',
    );
    expect(normalisePaymentLinkUrl('http://buy.stripe.com/test_123')).toBeNull();
    expect(normalisePaymentLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalisePaymentLinkUrl('not a url')).toBeNull();
    expect(normalisePaymentLinkUrl('https://')).toBeNull();
    expect(
      normalisePaymentLinkUrl(`https://buy.stripe.com/${'a'.repeat(PAYMENT_LINK_URL_MAX)}`),
    ).toBeNull();
  });

  it('validates optional payment link inputs', () => {
    expect(isValidPaymentLinkUrl(undefined)).toBe(true);
    expect(isValidPaymentLinkUrl('')).toBe(true);
    expect(isValidPaymentLinkUrl('   ')).toBe(true);
    expect(isValidPaymentLinkUrl('https://pay.sumup.com/b2c/Q123')).toBe(true);
    expect(isValidPaymentLinkUrl('http://pay.sumup.com/b2c/Q123')).toBe(false);
    expect(isValidPaymentLinkUrl('ftp://example.org/pay')).toBe(false);
  });

  it('extracts https URLs from free-text paymentDestination strings', () => {
    expect(extractHttpsUrlFromText(null)).toBeNull();
    expect(extractHttpsUrlFromText('Sort code 12-34-56, Account 12345678')).toBeNull();
    expect(
      extractHttpsUrlFromText(
        'Sort code 12-34-56 Acc 12345678 (or pay by card at https://buy.stripe.com/test_abc123).',
      ),
    ).toBe('https://buy.stripe.com/test_abc123');
  });

  it('resolves explicit paymentLinkUrl first and falls back to paymentDestination', () => {
    expect(resolvePaymentLinkUrl(null)).toBeNull();
    expect(
      resolvePaymentLinkUrl({
        paymentLinkUrl: 'https://pay.sumup.com/b2c/EXPLICIT',
        paymentDestination: 'Fallback https://buy.stripe.com/test_fallback',
      }),
    ).toBe('https://pay.sumup.com/b2c/EXPLICIT');
    expect(
      resolvePaymentLinkUrl({
        paymentLinkUrl: null,
        paymentDestination: 'Pay by card: https://paypal.me/mountedgames!',
      }),
    ).toBe('https://paypal.me/mountedgames');
  });

  it('detects provider labels and returns standard CTA copy', () => {
    expect(paymentProviderLabel('https://buy.stripe.com/test_123')).toBe('Stripe');
    expect(paymentProviderLabel('https://stripe.com/pay')).toBe('Stripe');
    expect(paymentProviderLabel('https://pay.sumup.com/b2c/Q123')).toBe('SumUp');
    expect(paymentProviderLabel('https://sumup.io/pay')).toBe('SumUp');
    expect(paymentProviderLabel('https://paypal.me/club')).toBe('PayPal');
    expect(paymentProviderLabel('https://www.paypal.com/ncp/payment/123')).toBe('PayPal');
    expect(paymentProviderLabel('https://square.link/u/abc')).toBe('Square');
    expect(paymentProviderLabel('https://checkout.squareup.com/pay')).toBe('Square');
    expect(paymentProviderLabel('https://payments.example.org/checkout')).toBe('Card / Apple Pay');
    expect(paymentProviderLabel(null)).toBe('Card / Apple Pay');
    expect(paymentLinkCtaLabel()).toBe('Pay Online by Card / Apple Pay →');
  });
});
