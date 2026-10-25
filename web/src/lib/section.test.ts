import { describe, expect, it } from 'vitest';
import { displaySectionName, sectionDisplayName, singularAgeGroup } from './section';

describe('sectionDisplayName', () => {
  it.each([
    [3, 'Juniors', 'Junior Individuals'],
    [1, 'Novices', 'Novice Pairs'],
    [2, 'Open', 'Open'],
    [2, 'Seniors', 'Seniors'],
    [2, 'Juniors', 'Juniors'],
    [2, 'Under 12', 'Under 12'],
    [2, 'Mixed Beginners', 'Mixed Beginners'],
    [2, 'Senior Teams', 'Seniors'],
    [2, 'Junior Teams', 'Juniors'],
    [2, 'Novice Teams', 'Novices'],
    [2, 'Teams', 'Teams'],
    [2, '  ', 'Teams'],
    [1, 'Pairs', 'Pairs'],
    [1, 'Senior Pairs', 'Senior Pairs'],
    [3, '  ', 'Individuals'],
    [2, 'Class', 'Class'],
    [9, 'Open', 'Open'],
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
    ['Teams Under 12', 'Under 12'],
    ['TEAMS Seniors', 'Seniors'],
    ['Pairs Under 12', 'Under 12 Pairs'],
    ['Pairs Juniors', 'Junior Pairs'],
    ['Individual Juniors', 'Junior Individuals'],
    ['Senior Teams', 'Seniors'],
    ['Seniors teams', 'Seniors'],
    ['Seniors teams A', 'Seniors A'],
    ['Open teams B', 'Open B'],
    ['Junior Teams', 'Juniors'],
    ['Under 12 Teams', 'Under 12'],
    ['Under 18 teams', 'Under 18'],
    ['Open Teams', 'Open'],
    ['Seniors', 'Seniors'],
    ['Seniors A', 'Seniors A'],
    ['Teams', 'Teams'],
    ['  Under   12 ', 'Under 12'],
  ])('shows %j as %j', (input, expected) => {
    expect(displaySectionName(input)).toBe(expected);
  });

  it('returns an empty string for missing names', () => {
    for (const value of [undefined, null, '']) expect(displaySectionName(value)).toBe('');
  });
});
