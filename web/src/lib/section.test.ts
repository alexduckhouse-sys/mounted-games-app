import { describe, expect, it } from 'vitest';
import { displaySectionName } from './section';

describe('displaySectionName', () => {
  it.each([
    ['Teams Under 12', 'Under 12'],
    ['Senior Teams', 'Senior'],
    ['TEAMS Seniors', 'Seniors'],
    ['Pairs Under 12', 'Pairs Under 12'],
    ['Individual Under 12', 'Individual Under 12'],
  ])('turns %j into %j', (input, expected) => {
    expect(displaySectionName(input)).toBe(expected);
  });

  it('keeps the name when removing "Teams" would leave nothing', () => {
    expect(displaySectionName('Teams')).toBe('Teams');
  });

  it('returns an empty string for missing names', () => {
    for (const value of [undefined, null, '']) expect(displaySectionName(value)).toBe('');
  });
});
