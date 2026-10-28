import { describe, expect, it } from 'vitest';
import { clubLabel, isUnaffiliated } from './clubName';

describe('clubName', () => {
  it('treats blank and placeholder names as no club', () => {
    for (const name of [null, undefined, '', '  ', 'Unaffiliated', ' unaffiliated ', 'No club']) expect(isUnaffiliated(name)).toBe(true);
    expect(isUnaffiliated('Cotswold')).toBe(false);
  });
  it('shows nothing for no club and the trimmed name otherwise', () => {
    expect(clubLabel('Unaffiliated')).toBe('');
    expect(clubLabel(' Cotswold ')).toBe('Cotswold');
  });
});
