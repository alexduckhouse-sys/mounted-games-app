import { describe, expect, it } from 'vitest';
import { filterStandingsByDivision, lastPublishedRound, ordinal, positionLabels, roundStatus, seasonDivisions } from './seasonModel';
import { buildRows, seasonChoices } from './teamHistoryModel';
import type { SeasonRoundView, SeasonView, StandingView } from './seasonViewTypes';
import type { TeamProfileHistoryResult } from './teamProfileTypes';

const now = new Date(2026, 6, 18, 12, 0, 0);
function round(over: Partial<SeasonRoundView> = {}): SeasonRoundView {
  return { id: 'r', competitionId: 1, competitionName: 'Cup', competitionDate: new Date(2026, 5, 1, 10).toISOString(), competitionSectionId: 1, sectionName: 'U14', orderIndex: 1, isIncluded: true, publishedVersion: null, publishedAt: null, publicationIsCurrent: true, ...over };
}

describe('roundStatus', () => {
  it('derives Final, Provisional, LIVE, Upcoming and the rest from publication state and date', () => {
    expect(roundStatus(round({ publishedVersion: 1 }), now)).toEqual({ label: 'Final', tone: 'mut' });
    expect(roundStatus(round({ publishedVersion: 2, publicationIsCurrent: false }), now)).toEqual({ label: 'Provisional', tone: 'warn' });
    expect(roundStatus(round({ competitionDate: new Date(2026, 6, 18, 9).toISOString() }), now)).toEqual({ label: 'LIVE', tone: 'live' });
    expect(roundStatus(round({ competitionDate: new Date(2026, 8, 12).toISOString() }), now)).toEqual({ label: 'Upcoming', tone: 'mut' });
    expect(roundStatus(round(), now)).toEqual({ label: 'Awaiting results', tone: 'mut' });
    expect(roundStatus(round({ isIncluded: false, publishedVersion: 1 }), now)).toEqual({ label: 'Excluded', tone: 'mut' });
  });
  it('finds the latest included published round', () => {
    const rounds = [round({ id: 'a', orderIndex: 1, publishedVersion: 1 }), round({ id: 'b', orderIndex: 3, publishedVersion: 1 }), round({ id: 'c', orderIndex: 4 }), round({ id: 'd', orderIndex: 5, publishedVersion: 1, isIncluded: false })];
    expect(lastPublishedRound(rounds)?.id).toBe('b');
    expect(lastPublishedRound([round()])).toBeNull();
  });
});

describe('positions', () => {
  it('marks shared places with an equals sign and formats ordinals', () => {
    const row = (id: string, rank: number) => ({ rank, teamProfileId: id, teamName: id, clubName: '', totalPoints: 0, rounds: [] }) as StandingView;
    const labels = positionLabels([row('a', 1), row('b', 2), row('c', 2), row('d', 4)]);
    expect([...labels.values()]).toEqual(['1', '=2', '=2', '4']);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  });
});

describe('team history rows', () => {
  const result = (seasonId: string, year: number, roundId: string, version = 1): TeamProfileHistoryResult => ({ seasonId, seasonTitle: seasonId, seasonYear: year, roundId, roundOrder: 1, competitionName: 'Cup', competitionDate: `${year}-05-01T00:00:00Z`, publicationVersion: version, publishedAt: '', eventRank: 1, eventPoints: 1, seasonPoints: version });
  it('lists seasons newest first, once each', () => {
    expect(seasonChoices([result('old', 2025, 'a'), result('new', 2026, 'b'), result('new', 2026, 'c')]).map((c) => c.seasonId)).toEqual(['new', 'old']);
  });
  it('keeps the latest publication of a round when no season table is available', () => {
    const rows = buildRows([result('s', 2026, 'a', 1), result('s', 2026, 'a', 3)], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toBe(3);
  });
  it('ignores unpublished future rounds and excluded rounds when marking rounds not entered', () => {
    const season = { rounds: [round({ id: 'a', orderIndex: 1, publishedVersion: 1 }), round({ id: 'b', orderIndex: 2, publishedVersion: 1 }), round({ id: 'c', orderIndex: 3 }), round({ id: 'd', orderIndex: 4, publishedVersion: 1, isIncluded: false })] } as SeasonView;
    const rows = buildRows([result('s', 2026, 'a')], { season, standing: null });
    expect(rows.map((row) => [row.key, row.place])).toEqual([['b', null], ['a', 1]]);
  });
});

describe('multi-division standings', () => {
  it('keeps pairs and teams apart within the same age group and recalculates best results', () => {
    const rounds = [round({ id: 'pairs', format: 1, ageGroup: 'Seniors' }), round({ id: 'teams', format: 2, ageGroup: 'Seniors' })];
    const season = { rounds, format: 2, ageGroup: 'Seniors', bestResultsToCount: 1 } as SeasonView;
    const rows: StandingView[] = [{ rank: 1, teamProfileId: 'fake-rider', teamName: 'Fake Rider', clubName: 'Fake Club', totalPoints: 20, rounds: [
      { roundId: 'pairs', eventRank: 1, seasonPoints: 10, counted: false },
      { roundId: 'teams', eventRank: 1, seasonPoints: 20, counted: true },
    ] }];
    const pairs = filterStandingsByDivision(season, rows, 'Seniors', 1);
    expect(pairs[0]).toMatchObject({ totalPoints: 10, rounds: [{ roundId: 'pairs', counted: true }] });
    expect(filterStandingsByDivision(season, rows, 'all', 2)[0].totalPoints).toBe(20);
  });
  it('extracts divisions and filters standings per age group with tie-break by wins', () => {
    const rounds = [
      round({ id: 'r1', orderIndex: 1, sectionName: 'Under 12', ageGroup: 'Under 12', publishedVersion: 1 }),
      round({ id: 'r2', orderIndex: 2, sectionName: 'Seniors', ageGroup: 'Seniors', publishedVersion: 1 }),
      round({ id: 'r3', orderIndex: 3, sectionName: 'Seniors', ageGroup: 'Seniors', publishedVersion: 1 }),
    ];
    expect(seasonDivisions(rounds, 'All age groups')).toEqual(['Under 12', 'Seniors']);
    const season = { id: 's', title: 'League', year: 2026, format: 2, ageGroup: 'All age groups', bestResultsToCount: 2, placePoints: [], rounds, canManage: false } as SeasonView;
    const standings: StandingView[] = [
      { rank: 1, teamProfileId: 'u12-team', teamName: 'Young Stars', clubName: 'Club', totalPoints: 10, rounds: [{ roundId: 'r1', eventRank: 1, seasonPoints: 10, counted: true }] },
      { rank: 2, teamProfileId: 'sen-alpha', teamName: 'Alpha', clubName: 'Club', totalPoints: 16, rounds: [{ roundId: 'r2', eventRank: 2, seasonPoints: 8, counted: true }, { roundId: 'r3', eventRank: 2, seasonPoints: 8, counted: true }] },
      { rank: 2, teamProfileId: 'sen-zeta', teamName: 'Zeta', clubName: 'Club', totalPoints: 16, rounds: [{ roundId: 'r2', eventRank: 1, seasonPoints: 10, counted: true }, { roundId: 'r3', eventRank: 3, seasonPoints: 6, counted: true }] },
    ];
    const seniors = filterStandingsByDivision(season, standings, 'Seniors');
    expect(seniors.map((r) => [r.teamName, r.rank, r.totalPoints])).toEqual([
      ['Zeta', 1, 16],
      ['Alpha', 2, 16],
    ]);
  });
});
