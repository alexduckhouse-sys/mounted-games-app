import { describe, expect, it } from 'vitest';
import { contactLinks, dialNumber, internationalDigits, ringMessage } from './contactLinks';

describe('internationalDigits', () => {
  it('accepts + and 00 prefixes, ignoring separators', () => {
    expect(internationalDigits('+44 7700 900123')).toBe('447700900123');
    expect(internationalDigits('0044 (7700) 900-123')).toBe('447700900123');
    expect(internationalDigits('  +353.87.123.4567 ')).toBe('353871234567');
  });
  it('refuses national, short, long, lettered and empty values', () => {
    for (const v of ['07700 900123', '7700900123', '+44', '+1234567', '+1234567890123456', '+0447700900123', '+44 77x0 900123', '', null, undefined]) {
      expect(internationalDigits(v as string | null | undefined)).toBeNull();
    }
  });
});

describe('dialNumber', () => {
  it('keeps international numbers as +digits and national ones as typed digits', () => {
    expect(dialNumber('00 44 7700 900123')).toBe('+447700900123');
    expect(dialNumber('07700 900123')).toBe('07700900123');
  });
  it('refuses junk and too-short numbers', () => {
    for (const v of ['12345', 'call me', '07700 90012x', '', '   ', null, undefined]) {
      expect(dialNumber(v as string | null | undefined)).toBeNull();
    }
  });
});

describe('contactLinks', () => {
  it('builds both links for an international number with an encoded message', () => {
    const links = contactLinks('+44 7700 900123', 'Heat 2 & more? #1')!;
    expect(links.call).toBe('tel:+447700900123');
    expect(links.whatsApp).toBe('https://wa.me/447700900123?text=Heat%202%20%26%20more%3F%20%231');
  });
  it('gives only a call link for a national number', () => {
    expect(contactLinks('07700 900123', 'x')).toEqual({ call: 'tel:07700900123', whatsApp: null });
  });
  it('returns null when absent or invalid', () => {
    expect(contactLinks(null, 'x')).toBeNull();
    expect(contactLinks('nope', 'x')).toBeNull();
  });
});

describe('ringMessage', () => {
  it('states heat, arena and team plainly', () => {
    expect(ringMessage('Heat 3', 'Main Arena', 'Test A')).toBe('Test A: you are wanted at the collecting ring for Heat 3 in Main Arena.');
  });
});
