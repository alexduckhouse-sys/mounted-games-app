import { describe, expect, it } from 'vitest';
import { lastPublishedRound, ordinal, positionLabels, roundStatus } from './seasonModel';
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
