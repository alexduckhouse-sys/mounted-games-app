import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_OPT_IN_TEXT, EMAIL_OPT_IN_VERSION, confirmationEmailLabel, looksLikeEmail, newRequestId } from './emailOptIn';

describe('looksLikeEmail', () => {
  it('accepts ordinary addresses, ignoring surrounding spaces', () => {
    expect(looksLikeEmail('parent@example.org')).toBe(true);
    expect(looksLikeEmail('  first.last+pc@mail.example.co.uk ')).toBe(true);
  });

  it('refuses typos and anything that is not a single plain address', () => {
    for (const bad of ['', 'parent', 'parent@', '@example.org', 'parent@example', 'a b@example.org', 'a@b.org, c@d.org', 'Name <a@b.org>']) {
      expect(looksLikeEmail(bad)).toBe(false);
    }
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
