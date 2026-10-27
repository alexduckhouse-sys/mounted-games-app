import { describe, expect, it } from 'vitest';
import { setActiveLang } from '../i18n/translate';
import { localOrdinal } from './ordinalText';

describe('localOrdinal', () => {
  it('matches the English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map((n) => localOrdinal(n, 'en'))).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
  });

  it('writes French ordinals', () => {
    expect([1, 2, 10].map((n) => localOrdinal(n, 'fr'))).toEqual(['1er', '2e', '10e']);
  });

  it('writes Welsh ordinals', () => {
    expect([1, 2, 3, 5, 7, 11, 12, 20, 21].map((n) => localOrdinal(n, 'cy'))).toEqual(['1af', '2il', '3ydd', '5ed', '7fed', '11eg', '12fed', '20fed', '21ain']);
  });

  it('follows the active language by default', () => {
    expect(localOrdinal(1)).toBe('1st');
    setActiveLang('fr');
    expect(localOrdinal(1)).toBe('1er');
  });
});
