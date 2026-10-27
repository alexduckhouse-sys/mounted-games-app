import { describe, expect, it } from 'vitest';
import type { RiderEntry, SavedTeamDeclaration } from '../types';
import { STANDARD_CONFIG, type DecFormConfig } from './decFormConfig';
import {
  applySavedTeamToForm, blankRider, parseAgeGroupMaxAge, riderIssues, savedTeamSummaryLabel, slotMeta, type DecRider,
} from './decForm';

const config = (over: Partial<DecFormConfig> = {}): DecFormConfig => ({ ...STANDARD_CONFIG, ...over });
const rider = (over: Partial<DecRider> = {}): DecRider => ({ ...blankRider(), fullName: 'Ella', pony: 'Pickle', height: '13.2', dob: '05/04/2015', ...over });
const withExtra = (extra: Partial<DecRider['extra']>, over: Partial<DecRider> = {}): DecRider => {
  const r = rider(over);
  return { ...r, extra: { ...r.extra, ...extra } };
};

describe('riderIssues for a reserve', () => {
  it('flags a typed height that is not valid hands, but never demands one', () => {
    expect(riderIssues(rider({ height: '13.9' }), true).invalid.height).toMatch(/Use hands/);
    expect(riderIssues(rider({ height: '' }), true).invalid.height).toBeUndefined();
    expect(riderIssues(rider({ height: '13.2' }), true).invalid.height).toBeUndefined();
    expect(riderIssues(rider({ pony: '', height: '' }), true).missing).not.toContain('pony’s name');
  });

  it('does not check the reserve height when the form does not ask for it', () => {
    expect(riderIssues(rider({ height: '99' }), true, config({ ponyHeight: 0 })).invalid.height).toBeUndefined();
  });
});

describe('slotMeta', () => {
  it('shows a born year when the form asks for the year of birth', () => {
    const cfg = config({ dobFormat: 1 });
    expect(slotMeta(withExtra({ birthYear: '2012' }), false, cfg)).toBe('Pickle · 13.2 hh · born 2012');
    expect(slotMeta(withExtra({ birthYear: '' }), false, cfg)).toBe('Pickle · 13.2 hh');
  });

  it('shows the age group when the form asks for that', () => {
    const cfg = config({ dobFormat: 2 });
    expect(slotMeta(withExtra({ ageGroup: 'U12' }), false, cfg)).toBe('Pickle · 13.2 hh · U12');
    expect(slotMeta(withExtra({ ageGroup: '' }), false, cfg)).toBe('Pickle · 13.2 hh');
  });

  it('shows a typed date of birth, or leaves it out when empty or not asked', () => {
    expect(slotMeta(rider(), false)).toBe('Pickle · 13.2 hh · born 05/04/2015');
    expect(slotMeta(rider({ dob: '' }), false)).toBe('Pickle · 13.2 hh');
    expect(slotMeta(rider(), false, config({ dob: 0 }))).toBe('Pickle · 13.2 hh');
  });

  it('leaves out the height when it is not asked for or empty', () => {
    expect(slotMeta(rider(), false, config({ ponyHeight: 0, dob: 0 }))).toBe('Pickle');
    expect(slotMeta(rider({ height: '' }), false, config({ dob: 0 }))).toBe('Pickle');
  });

  it('calls a reserve with no pony or no height non-riding, and keeps pony details when both are given', () => {
    expect(slotMeta(rider({ pony: '', height: '' }), true)).toBe('Non-riding · born 05/04/2015');
    expect(slotMeta(rider({ height: '' }), true, config({ dob: 0 }))).toBe('Non-riding');
    expect(slotMeta(rider({ pony: '  ' }), true, config({ dob: 0 }))).toBe('Non-riding');
    expect(slotMeta(rider(), true, config({ dob: 0 }))).toBe('Pickle · 13.2 hh');
  });
});

describe('parseAgeGroupMaxAge', () => {
  it('reads U and Under forms, including hyphens and sections', () => {
    expect(parseAgeGroupMaxAge('under-14')).toBe(14);
    expect(parseAgeGroupMaxAge('Under 8 Pairs')).toBe(8);
    expect(parseAgeGroupMaxAge('u25')).toBe(25);
    expect(parseAgeGroupMaxAge('U6')).toBe(6);
    expect(parseAgeGroupMaxAge('Junior Pairs')).toBe(15);
  });
  it('gives null for blanks, out-of-range ages and open sections', () => {
    expect(parseAgeGroupMaxAge(null)).toBeNull();
    expect(parseAgeGroupMaxAge(undefined)).toBeNull();
    expect(parseAgeGroupMaxAge('   ')).toBeNull();
    expect(parseAgeGroupMaxAge('U5')).toBeNull();
    expect(parseAgeGroupMaxAge('U26')).toBeNull();
    expect(parseAgeGroupMaxAge('Senior')).toBeNull();
  });
});

const entry = (id: number, extra: Partial<RiderEntry> = {}): RiderEntry =>
  ({ id, fullName: `Rider ${id}`, isCaptain: false, isReserve: false, orderIndex: id, ...extra } as RiderEntry);

const saved = (over: Partial<SavedTeamDeclaration> = {}): SavedTeamDeclaration => ({
  teamId: 1, teamName: 'Kent A', clubName: 'Kent', sectionName: 'U15 Teams', ageGroup: 'U15', format: 2, competitionId: 1,
  competitionName: 'Spring', submittedAt: '2026-05-08T18:30:00Z', riders: [], ...over,
});

describe('savedTeamSummaryLabel', () => {
  it('uses singular and plural rider counts and mentions a reserve', () => {
    expect(savedTeamSummaryLabel(saved({ riders: [entry(1)] }))).toBe('Kent A · U15 · Spring (1 rider)');
    expect(savedTeamSummaryLabel(saved({ riders: [entry(1), entry(2)] }))).toBe('Kent A · U15 · Spring (2 riders)');
    expect(savedTeamSummaryLabel(saved({ riders: [entry(1), entry(2, { isReserve: true })] }))).toBe('Kent A · U15 · Spring (1 riders + reserve)');
    expect(savedTeamSummaryLabel(saved())).toBe('Kent A · U15 · Spring (0 riders)');
  });
  it('falls back from entry name to team name and from age group to section name', () => {
    expect(savedTeamSummaryLabel(saved({ entryTeamName: 'Kent Invicta', ageGroup: '' }))).toBe('Kent Invicta · U15 Teams · Spring (0 riders)');
    expect(savedTeamSummaryLabel(saved({ entryTeamName: '', teamName: '', ageGroup: '', sectionName: '', competitionName: '' }))).toBe(' (0 riders)');
  });
});

describe('applySavedTeamToForm branches', () => {
  it('ignores the reserve for a pair and truncates extra riders to the slots available', () => {
    const team = saved({ format: 1, riders: [entry(1), entry(2), entry(3), entry(4, { isReserve: true, orderIndex: 9 })] });
    const applied = applySavedTeamToForm(team, 1);
    expect(applied.slots.map((s) => s?.fullName)).toEqual(['Rider 1', 'Rider 2']);
  });

  it('puts the reserve in the last slot of a team, and leaves unused riding slots empty', () => {
    const team = saved({ riders: [entry(2, { isReserve: true, orderIndex: 5 }), entry(1, { orderIndex: 0 })] });
    const applied = applySavedTeamToForm(team, 2);
    expect(applied.slots).toHaveLength(6);
    expect(applied.slots[0]?.fullName).toBe('Rider 1');
    expect(applied.slots[1]).toBeNull();
    expect(applied.slots[5]?.fullName).toBe('Rider 2');
  });

  it('uses defaults when the saved team has no names, bib or trainer details', () => {
    const applied = applySavedTeamToForm(saved({ teamName: '', entryTeamName: null, bibDescription: null, trainerName: null, trainerPhone: null }), undefined);
    expect(applied).toMatchObject({ teamName: '', bibs: '', flag: '', trainerName: '', phone: '', ageWarnings: [] });
    const trimmed = applySavedTeamToForm(saved({ entryTeamName: '  Kent Invicta ', trainerName: ' Sam ', trainerPhone: ' 0770 ', bibDescription: 'Red' }), 2);
    expect(trimmed).toMatchObject({ teamName: 'Kent Invicta', trainerName: 'Sam', phone: '0770', bibs: 'Red', flag: '' });
    expect(applySavedTeamToForm(saved({ entryTeamName: '', teamName: 'Fallback' }), 2).teamName).toBe('Fallback');
  });

  describe('age warnings', () => {
    const team = saved({
      riders: [
        entry(1, { orderIndex: 0, dateOfBirth: '2012-03-14' }),
        entry(2, { orderIndex: 1, dateOfBirth: '2016-03-14' }),
        entry(3, { orderIndex: 2, birthYear: 2010 }),
        entry(4, { orderIndex: 3 }),
      ],
    });
    const warn = (opts: Parameters<typeof applySavedTeamToForm>[3], cfg = STANDARD_CONFIG) =>
      applySavedTeamToForm(team, 2, cfg, opts).ageWarnings;

    it('warns only for riders older than the band, using a typed date or a birth year', () => {
      const w = warn({ targetAgeGroup: 'U12', competitionYear: 2026 });
      expect(w.map((x) => [x.slotIndex, x.birthYear, x.ageInCompetitionYear])).toEqual([[0, 2012, 14], [2, 2010, 16]]);
      expect(w[0].message).toBe('Rider 1 turns 14 in 2026 (check U12 eligibility).');
    });

    it('skips riders with neither a date nor a year of birth', () => {
      const w = warn({ targetAgeGroup: 'U12', competitionYear: 2026 });
      expect(w.map((x) => x.riderName)).not.toContain('Rider 4');
      expect(w.map((x) => x.riderName)).not.toContain('Rider 2');
    });

    it('does not warn without an age band, a usable year or options', () => {
      expect(warn({ targetAgeGroup: 'Open', competitionYear: 2026 })).toEqual([]);
      expect(warn({ targetAgeGroup: 'U12', competitionYear: null })).toEqual([]);
      expect(warn({ targetAgeGroup: 'U12', competitionYear: 1999 })).toEqual([]);
      expect(warn({ targetAgeGroup: 'U12' })).toEqual([]);
      expect(warn({})).toEqual([]);
      expect(warn(undefined)).toEqual([]);
    });

    it('does not warn for a rider exactly at the limit', () => {
      expect(warn({ targetAgeGroup: 'U16', competitionYear: 2026 })).toEqual([]);
    });
  });
});
