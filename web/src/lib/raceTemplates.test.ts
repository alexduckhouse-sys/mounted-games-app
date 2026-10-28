import { describe, expect, it } from 'vitest';
import type { RaceTemplate } from '../types';
import { findRaceTemplate, isFormatVariant, raceListNames, sessionFormat } from './raceTemplates';

const t = (name: string, extra: Partial<RaceTemplate> = {}): RaceTemplate => ({ id: name.length, name, isBuiltIn: true, ...extra });
const list = [
  t('Bending'),
  t('Bending (Pairs)', { baseName: 'Bending', format: 1 }),
  t('Five Flag'),
  t('Five Flag (Pairs)', { baseName: 'Five Flag', format: 1 }),
  t('Five Flag (Individual)', { baseName: 'Five Flag', format: 3 }),
  t('5 Flag', { baseName: 'Five Flag' }),
  t('Three Mug and Table (Pairs)'),
];

describe('findRaceTemplate', () => {
  it('reads the race itself for teams or an unknown format', () => {
    expect(findRaceTemplate(list, ' bending ')?.name).toBe('Bending');
    expect(findRaceTemplate(list, 'Bending', 2)?.name).toBe('Bending');
    expect(findRaceTemplate(list, 'Bending', null)?.name).toBe('Bending');
  });

  it('reads the pairs or individual version for those sections', () => {
    expect(findRaceTemplate(list, 'Bending', 1)?.name).toBe('Bending (Pairs)');
    expect(findRaceTemplate(list, 'Five Flag', 3)?.name).toBe('Five Flag (Individual)');
  });

  it('falls back to the race when there is no version for the format', () => {
    expect(findRaceTemplate(list, 'Bending', 3)?.name).toBe('Bending');
  });

  it('follows a sponsored name to its base race', () => {
    expect(findRaceTemplate(list, '5 Flag', 1)?.name).toBe('Five Flag (Pairs)');
    expect(findRaceTemplate(list, '5 Flag', 2)?.name).toBe('5 Flag');
  });

  it('keeps a variant asked for by name, and a pairs-only race', () => {
    expect(findRaceTemplate(list, 'Bending (Pairs)', 1)?.name).toBe('Bending (Pairs)');
    expect(findRaceTemplate(list, 'Three Mug and Table (Pairs)', 1)?.name).toBe('Three Mug and Table (Pairs)');
  });

  it('finds the version even when the timetable race has no template of its own', () => {
    expect(findRaceTemplate([t('Bending (Pairs)', { baseName: 'Bending', format: 1 })], 'Bending', 1)?.name).toBe('Bending (Pairs)');
    expect(findRaceTemplate(list, 'Nobody wrote this', 1)).toBeNull();
  });
});

describe('race lists', () => {
  it('leave out the versions a section picks by itself', () => {
    expect(list.filter(isFormatVariant).map((x) => x.name)).toEqual(['Bending (Pairs)', 'Five Flag (Pairs)', 'Five Flag (Individual)']);
    expect(raceListNames(list)).toEqual(['Bending', 'Five Flag', '5 Flag', 'Three Mug and Table (Pairs)']);
  });
});

describe('sessionFormat', () => {
  const competition = { sections: [{ id: 4, format: 1 as const }, { id: 5, format: 3 as const }] };
  it('reads the format of the session’s section', () => {
    expect(sessionFormat(competition, { competitionSectionId: 4 })).toBe(1);
    expect(sessionFormat(competition, { competitionSectionId: 5 })).toBe(3);
  });
  it('is null without a section or a match', () => {
    expect(sessionFormat(competition, { competitionSectionId: null })).toBeNull();
    expect(sessionFormat(competition, { competitionSectionId: 9 })).toBeNull();
    expect(sessionFormat(null, { competitionSectionId: 4 })).toBeNull();
    expect(sessionFormat(competition, null)).toBeNull();
  });
});
