import { describe, expect, it } from 'vitest';
import source from '../pages/admin/CompetitionEditor.tsx?raw';
import { AREA_JUNIORS, AREA_PAIRS, AREA_SENIORS, ZONE_JUNIORS, ZONE_PAIRS, ZONE_SENIORS, defaultRaceList, scopeOf } from './defaultRaces';

function listNamed(name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`).exec(source);
  if (!match) throw new Error(`${name} not found`);
  return [...match[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
}

describe('default race lists', () => {
  it.each([
    ['ZONE_SENIORS', ZONE_SENIORS], ['ZONE_JUNIORS', ZONE_JUNIORS], ['ZONE_PAIRS', ZONE_PAIRS],
    ['AREA_SENIORS', AREA_SENIORS], ['AREA_JUNIORS', AREA_JUNIORS], ['AREA_PAIRS', AREA_PAIRS],
  ])('%s matches the competition editor', (name, list) => {
    expect(list).toEqual(listNamed(name));
  });

  it('picks pairs for pairs, juniors and novices for the junior list, and the seniors list otherwise', () => {
    expect(defaultRaceList('Zone', 1, 'Open')).toEqual(ZONE_PAIRS);
    expect(defaultRaceList('Area', 1, 'Junior')).toEqual(AREA_PAIRS);
    expect(defaultRaceList('Zone', 2, 'Junior')).toEqual(ZONE_JUNIORS);
    expect(defaultRaceList('Area', 2, 'Novices')).toEqual(AREA_JUNIORS);
    expect(defaultRaceList('Zone', 2, 'Open')).toEqual(ZONE_SENIORS);
    expect(defaultRaceList('Area', 3, 'Seniors')).toEqual(AREA_SENIORS);
  });

  it('hands out copies, so editing one list leaves the standard alone', () => {
    defaultRaceList('Zone', 2, 'Open').push('Extra');
    expect(defaultRaceList('Zone', 2, 'Open')).toEqual(ZONE_SENIORS);
  });

  it('says which standard list a set of races is, or none', () => {
    expect(scopeOf(ZONE_SENIORS, 2, 'Open')).toBe('Zone');
    expect(scopeOf(AREA_SENIORS, 2, 'Open')).toBe('Area');
    expect(scopeOf(['Bending'], 2, 'Open')).toBeNull();
    expect(scopeOf([...ZONE_SENIORS].reverse(), 2, 'Open')).toBeNull();
  });
});
