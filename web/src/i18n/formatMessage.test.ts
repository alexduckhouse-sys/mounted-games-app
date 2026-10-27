import { describe, expect, it } from 'vitest';
import { formatMessage } from './translate';

describe('formatMessage', () => {
  const teams = { zero: 'Dim timau', one: 'Un tîm', two: 'Dau dîm', few: 'Tri thîm', many: '{count} thîm', other: '{count} tîm' };

  it('fills in placeholders and leaves unknown ones visible', () => {
    expect(formatMessage('Hello {name}', 'en', { name: 'Sam' })).toBe('Hello Sam');
    expect(formatMessage('Hello {name} {other}', 'en', { name: 'Sam' })).toBe('Hello Sam {other}');
    expect(formatMessage('Hello', 'en')).toBe('Hello');
  });

  it('chooses English plural forms', () => {
    const forms = { one: '{count} team', other: '{count} teams' };
    expect(formatMessage(forms, 'en', { count: 1 })).toBe('1 team');
    expect(formatMessage(forms, 'en', { count: 3 })).toBe('3 teams');
    expect(formatMessage(forms, 'en', { count: 0 })).toBe('0 teams');
    expect(formatMessage({ ...forms, zero: 'No teams' }, 'en', { count: 0 })).toBe('No teams');
    expect(formatMessage(forms, 'en')).toBe('{count} teams');
  });

  it('uses all six Welsh plural categories', () => {
    expect(formatMessage(teams, 'cy', { count: 0 })).toBe('Dim timau');
    expect(formatMessage(teams, 'cy', { count: 1 })).toBe('Un tîm');
    expect(formatMessage(teams, 'cy', { count: 2 })).toBe('Dau dîm');
    expect(formatMessage(teams, 'cy', { count: 3 })).toBe('Tri thîm');
    expect(formatMessage(teams, 'cy', { count: 6 })).toBe('6 thîm');
    expect(formatMessage(teams, 'cy', { count: 4 })).toBe('4 tîm');
  });

  it('falls back to other when a category has no form', () => {
    expect(formatMessage({ other: '{count} x' }, 'cy', { count: 2 })).toBe('2 x');
  });

  it('treats 0 as singular in French', () => {
    const forms = { one: '{count} équipe', other: '{count} équipes' };
    expect(formatMessage(forms, 'fr', { count: 0 })).toBe('0 équipe');
    expect(formatMessage(forms, 'fr', { count: 2 })).toBe('2 équipes');
  });
});
