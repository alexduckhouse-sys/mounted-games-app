import { describe, expect, it } from 'vitest';
import type { StatsGame, StatsSummary } from '../types';
import {
  STATS_TABS, finalLabel, formatPercent, isSearchableQuery, isStatsBrowse, isStatsProfile, ordinalPlace, plural, pointsOf,
  gameLine, statsFacts, statsKindFromPath, statsProfileHref, summaryTiles, tidyStatsQuery,
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
    const abc = summaryTiles(summary({ entriesWithFinals: 3, aFinals: 1, bFinals: 1, cFinals: 1 }));
    expect(abc[3].detail).toBe('A 1 · B 1 · C 1 (of 3)');
  });
});

describe('plain figures for the team profile', () => {
  it('lists each figure as a label and one line of text', () => {
    expect(statsFacts(summary())).toEqual([
      { label: 'Competitions', value: '2' },
      { label: 'Podiums', value: '2 (1st 1, 2nd 1, 3rd 0)' },
      { label: 'Average place', value: '1.5' },
      { label: 'A Finals', value: '1 of 1' },
      { label: 'Points', value: '7 of 12 (58.3%)' },
      { label: 'Races won', value: '1 of 4' },
    ]);
  });

  it('says so when there is nothing to show yet', () => {
    const facts = statsFacts(summary({ firsts: 0, seconds: 0, thirds: 0, averagePlace: null, entriesWithFinals: 0, pointQuotaPercent: null, points: 0, maxPoints: 0, races: 0, wins: 0 }));
    expect(facts.map((fact) => fact.value)).toEqual(['2', 'None yet', '—', 'No finals run', '0 of 0', '0 of 0']);
  });

  it('breaks the finals down when B or C finals were reached', () => {
    expect(statsFacts(summary({ entriesWithFinals: 5, aFinals: 2, bFinals: 2, cFinals: 1 }))[3].value).toBe('A 2 · B 2 · C 1 of 5');
  });

  const game = (overrides: Partial<StatsGame> = {}): StatsGame => ({ name: 'Two Flag', races: 12, wins: 2, winPercent: 16.7, nonFinishes: 0, points: 49, maxPoints: 84, pointQuotaPercent: 58.3, averagePoints: 4.1, averagePlace: 5.8, ...overrides });

  it('describes a game on one line', () => {
    expect(gameLine(game())).toBe('12 races · 2 wins · average 4.1 pts · average place 5.8');
    expect(gameLine(game({ races: 1, wins: 1 }))).toBe('1 race · 1 win · average 4.1 pts · average place 5.8');
  });

  it('works the average out when the API did not, and leaves out what is not known', () => {
    expect(gameLine(game({ averagePoints: undefined, averagePlace: null }))).toBe('12 races · 2 wins · average 4.1 pts');
    expect(gameLine(game({ averagePoints: null, races: 0, points: 0, wins: 0, averagePlace: undefined }))).toBe('0 races · 0 wins');
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
