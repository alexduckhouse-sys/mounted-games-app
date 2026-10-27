import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_OPT_IN_TEXT, EMAIL_OPT_IN_VERSION, confirmationEmailLabel, looksLikeEmail, newRequestId } from './emailOptIn';

describe('looksLikeEmail', () => {
  it('accepts normal addresses and rejects blanks, spaces, or missing domains', () => {
    expect(looksLikeEmail('rider@example.co.uk')).toBe(true);
    expect(looksLikeEmail('  rider@example.com ')).toBe(true);
    expect(looksLikeEmail('')).toBe(false);
    expect(looksLikeEmail('rider@example')).toBe(false);
    expect(looksLikeEmail('rider@.com')).toBe(false);
    expect(looksLikeEmail('rider@example.')).toBe(false);
    expect(looksLikeEmail('@example.com')).toBe(false);
    expect(looksLikeEmail('a@b@c.com')).toBe(false);
    expect(looksLikeEmail('rider @example.com')).toBe(false);
    expect(looksLikeEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('newRequestId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses a random UUID when the browser has one', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1' });
    expect(newRequestId()).toBe('uuid-1');
  });

  it('falls back to a different short id each time', () => {
    vi.stubGlobal('crypto', undefined);
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(64);
  });
});

describe('confirmationEmailLabel', () => {
  it('tells an organiser what happened to each confirmation', () => {
    expect(confirmationEmailLabel(1, true)).toBe('Confirmation emailed');
    expect(confirmationEmailLabel(2, true)).toBe('Confirmation email failed');
    expect(confirmationEmailLabel(3, true)).toBe('Confirmation not sent (email is off)');
    expect(confirmationEmailLabel(0, true)).toBe('Confirmation not sent');
    expect(confirmationEmailLabel(undefined, true)).toBe('Confirmation not sent');
    expect(confirmationEmailLabel(1, false)).toBe('No email address');
  });
});

describe('opt-in wording', () => {
  it('keeps the version and sentence the server expects', () => {
    expect(EMAIL_OPT_IN_VERSION).toBe('alerts-2026-10-22');
    expect(EMAIL_OPT_IN_TEXT).toBe('Email me when new competitions open. I can unsubscribe at any time.');
  });
});
