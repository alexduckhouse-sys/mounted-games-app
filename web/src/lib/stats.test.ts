import { describe, expect, it } from 'vitest';
import type { StatsSummary } from '../types';
import {
  STATS_TABS, finalLabel, formatPercent, isSearchableQuery, isStatsBrowse, isStatsProfile, ordinalPlace, plural, pointsOf,
  statsKindFromPath, statsProfileHref, summaryTiles, tidyStatsQuery,
} from './stats';

const summary = (overrides: Partial<StatsSummary> = {}): StatsSummary => ({
  competitions: 2, entries: 3, placedEntries: 2, firsts: 1, seconds: 1, thirds: 0, averagePlace: 1.5,
  entriesWithFinals: 1, finalsReached: 1, aFinals: 1, aFinalPercent: 100, races: 4, wins: 1, winPercent: 25,
  points: 7, maxPoints: 12, pointQuotaPercent: 58.3, ...overrides,
});

describe('stats paths', () => {
  it('maps kinds to URL segments and back', () => {
    expect(statsKindFromPath('riders')).toBe(0);
    expect(statsKindFromPath('ponies')).toBe(1);
    expect(statsKindFromPath('teams')).toBe(2);
    expect(statsKindFromPath('clubs')).toBe(3);
    expect(statsKindFromPath('horses')).toBeNull();
    expect(statsKindFromPath(undefined)).toBeNull();
    expect(statsProfileHref(0, 'oliver s.')).toBe('/stats/riders?name=oliver%20s.');
    expect(statsProfileHref(3, 'a&b')).toBe('/stats/clubs?name=a%26b');
  });
});

describe('queries', () => {
  it('tidies whitespace and mirrors the API limits', () => {
    expect(tidyStatsQuery('  Oliver   S. ')).toBe('Oliver S.');
    expect(isSearchableQuery('ab')).toBe(true);
    expect(isSearchableQuery(' a ')).toBe(false);
    expect(isSearchableQuery('..')).toBe(false);
    expect(isSearchableQuery('a'.repeat(80))).toBe(true);
    expect(isSearchableQuery('a'.repeat(81))).toBe(false);
  });
});

describe('formatting', () => {
  it('formats percentages, places, finals and counts', () => {
    expect(formatPercent(50)).toBe('50%');
    expect(formatPercent(62.5)).toBe('62.5%');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinalPlace))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
    expect(finalLabel(0)).toBe('A Final');
    expect(finalLabel(2)).toBe('C Final');
    expect(finalLabel(null)).toBeNull();
    expect(finalLabel(-1)).toBeNull();
    expect(finalLabel(26)).toBeNull();
    expect(pointsOf(3, 6)).toBe('3 of 6 points');
    expect(pointsOf(1, 1)).toBe('1 of 1 point');
    expect(plural(1, 'race')).toBe('1 race');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
  });

  it('builds the headline tiles', () => {
    expect(summaryTiles(summary())).toEqual([
      { label: 'Competitions', value: '2', detail: '3 age-group entries' },
      { label: 'Podiums', value: '2', detail: '1st 1 · 2nd 1 · 3rd 0' },
      { label: 'Average place', value: '1.5', detail: 'Over 2 placed entries' },
      { label: 'A Final', value: '100%', detail: '1 of 1 with finals' },
      { label: 'Point quota', value: '58.3%', detail: '7 of 12 points' },
      { label: 'Races won', value: '25%', detail: '1 of 4 races' },
    ]);
    const empty = summaryTiles(summary({ entries: 1, placedEntries: 0, averagePlace: null, entriesWithFinals: 0, aFinalPercent: null, races: 1, wins: 0, winPercent: 0 }));
    expect(empty.map((tile) => tile.detail)).toEqual(['1 age-group entry', '1st 1 · 2nd 1 · 3rd 0', 'No placed entries', 'No finals run', '7 of 12 points', '0 of 1 race']);
    expect(empty[2].value).toBe('—');
  });
});

describe('response guards', () => {
  const hit = { kind: 0, name: 'Oliver S.', key: 'oliver s.', competitions: 2 };
  const browse = { kind: 0, query: '', page: 1, pageSize: 24, total: 1, items: [hit] };

  it('accepts a browse page', () => {
    expect(isStatsBrowse(browse)).toBe(true);
    expect(isStatsBrowse({ ...browse, items: [] })).toBe(true);
  });

  it.each([null, '<!doctype html>', {}, { ...browse, items: null }, { ...browse, total: '1' }, { ...browse, page: undefined }, { ...browse, items: [{ name: 'x' }] }])('rejects a browse page shaped like %j', (value) => {
    expect(isStatsBrowse(value)).toBe(false);
  });

  it('has one tab per kind, in the order the profile paths use', () => {
    expect(STATS_TABS.map((tab) => [tab.kind, tab.plural])).toEqual([[0, 'riders'], [1, 'ponies'], [2, 'teams'], [3, 'clubs']]);
  });

  it('accepts a summary-only and a detailed profile, and rejects anything else', () => {
    const base = { kind: 0, name: 'Oliver S.', key: 'oliver s.', detailed: false, raceFiguresAllFormats: false, summary: summary(), games: null, bestGames: null, worstGames: null, entries: null, partnerships: null };
    expect(isStatsProfile(base)).toBe(true);
    expect(isStatsProfile({ ...base, detailed: true, games: [], bestGames: [], worstGames: [], entries: [], partnerships: [] })).toBe(true);
    expect(isStatsProfile({ ...base, games: 'x' })).toBe(false);
    expect(isStatsProfile({ ...base, summary: null })).toBe(false);
    expect(isStatsProfile({ ...base, summary: {} })).toBe(false);
    expect(isStatsProfile({ ...base, name: 4 })).toBe(false);
    expect(isStatsProfile('<html>')).toBe(false);
  });
});
