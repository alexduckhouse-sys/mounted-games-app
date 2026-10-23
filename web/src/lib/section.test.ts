import { describe, expect, it } from 'vitest';
import { displaySectionName, sectionDisplayName, singularAgeGroup } from './section';

describe('sectionDisplayName', () => {
  it.each([
    [3, 'Juniors', 'Junior Individuals'],
    [1, 'Novices', 'Novice Pairs'],
    [2, 'Open', 'Open Teams'],
    [2, 'Seniors', 'Senior Teams'],
    [2, 'Under 12', 'Under 12 Teams'],
    [2, 'Mixed Beginners', 'Mixed Beginner Teams'],
    [2, 'Senior Teams', 'Senior Teams'],
    [1, 'Pairs', 'Pairs'],
    [3, '  ', 'Individuals'],
    [2, 'Class', 'Class Teams'],
    [9, 'Open', 'Open Teams'],
  ])('format %j and %j make %j', (format, age, expected) => {
    expect(sectionDisplayName(format, age)).toBe(expected);
  });

  it('singularises only a plural last word', () => {
    expect(singularAgeGroup(' Juniors ')).toBe('Junior');
    expect(singularAgeGroup('Under 12')).toBe('Under 12');
    expect(singularAgeGroup('Bs')).toBe('Bs');
  });
});

describe('displaySectionName', () => {
  it.each([
    ['Teams Under 12', 'Under 12 Teams'],
    ['TEAMS Seniors', 'Senior Teams'],
    ['Pairs Under 12', 'Under 12 Pairs'],
    ['Pairs Juniors', 'Junior Pairs'],
    ['Individual Juniors', 'Junior Individuals'],
    ['Senior Teams', 'Senior Teams'],
    ['Open Teams', 'Open Teams'],
    ['Seniors', 'Seniors'],
    ['Teams', 'Teams'],
    ['  Under   12 ', 'Under 12'],
  ])('shows %j as %j', (input, expected) => {
    expect(displaySectionName(input)).toBe(expected);
  });

  it('returns an empty string for missing names', () => {
    for (const value of [undefined, null, '']) expect(displaySectionName(value)).toBe('');
  });
});
