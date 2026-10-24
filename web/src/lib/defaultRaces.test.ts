import { describe, expect, it } from 'vitest';
import { AREA_INDIVIDUALS, AREA_JUNIORS, AREA_PAIRS, AREA_SENIORS, ZONE_INDIVIDUALS, ZONE_JUNIORS, ZONE_PAIRS, ZONE_SENIORS, defaultRaceList, scopeOf } from './defaultRaces';

describe('default race lists', () => {
  it.each([['ZONE_PAIRS', ZONE_PAIRS], ['AREA_PAIRS', AREA_PAIRS]])('%s has no race twice in a row', (_name, list) => {
    expect(list.length).toBeGreaterThan(5);
    list.forEach((race, i) => {
      if (i > 0) expect(race, `${race} at position ${i + 1}`).not.toBe(list[i - 1]);
    });
  });

  it('lists the Zone and Area pairs races once each', () => {
    expect(ZONE_PAIRS).toEqual([
      'Bending', 'Hollywood Bowl Boule & Bucket', 'Bottle', 'Litter', 'Tally Ho Farm Ball & Socket', 'STRUK Pole',
      'PGSports UK Shopping Spree', 'Stepping Stones', 'EGUK Mug Changes', '5 Flag',
    ]);
    expect(AREA_PAIRS).toEqual([
      'Bending', '2 Mug', 'Old Sock', 'Tally Ho Farm Ball & Socket', 'PGUK Pyramid', 'Hollywood Bowl Bottle', 'Stepping Stones', 'EGUK 5 Flag',
    ]);
  });

  it('keeps the senior and junior lists', () => {
    expect(ZONE_SENIORS).toHaveLength(10);
    expect(ZONE_JUNIORS).toHaveLength(8);
    expect(AREA_SENIORS).toHaveLength(8);
    expect(AREA_JUNIORS).toHaveLength(7);
  });

  it('picks pairs for pairs, juniors/under-12s and novices for the junior list, individuals without team-only races, and the seniors list otherwise', () => {
    expect(defaultRaceList('Zone', 1, 'Open')).toEqual(ZONE_PAIRS);
    expect(defaultRaceList('Area', 1, 'Junior')).toEqual(AREA_PAIRS);
    expect(defaultRaceList('Zone', 2, 'Junior')).toEqual(ZONE_JUNIORS);
    expect(defaultRaceList('Zone', 2, 'Under 10')).toEqual(ZONE_JUNIORS);
    expect(defaultRaceList('Area', 2, 'Under 12')).toEqual(AREA_JUNIORS);
    expect(defaultRaceList('Area', 2, 'U12')).toEqual(AREA_JUNIORS);
    expect(defaultRaceList('Area', 2, 'Novices')).toEqual(AREA_JUNIORS);
    expect(defaultRaceList('Zone', 2, 'Under 14')).toEqual(ZONE_SENIORS);
    expect(defaultRaceList('Zone', 2, 'Open')).toEqual(ZONE_SENIORS);
    expect(defaultRaceList('Zone', 3, 'Seniors')).toEqual(ZONE_INDIVIDUALS);
    expect(defaultRaceList('Area', 3, 'Seniors')).toEqual(AREA_INDIVIDUALS);
    expect(defaultRaceList('Zone', 3, 'Seniors')).not.toContain('Big Sack');
    expect(defaultRaceList('Area', 3, 'Seniors')).not.toContain('5 Mug');
    expect(defaultRaceList('Zone', 3, 'Under 12')).not.toContain('Spell EGUK (JV)');
    expect(defaultRaceList('Area', 3, 'Under 10')).toEqual(AREA_JUNIORS);
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
