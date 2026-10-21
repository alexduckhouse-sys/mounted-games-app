import type { SeasonView, StandingView } from './seasonViewTypes';
import type { TeamProfileHistoryResult } from './teamProfileTypes';

export interface HistoryRow {
  key: string;
  order: number;
  name: string;
  date: string;
  place: number | null;
  points: number | null;
  /** A result that falls outside the season's "best N" count. */
  dropped: boolean;
}

export interface SeasonChoice { seasonId: string; title: string; year: number }

/** One entry per season the team has published results in, newest first. */
export function seasonChoices(results: TeamProfileHistoryResult[]): SeasonChoice[] {
  const seen = new Map<string, SeasonChoice & { latest: string }>();
  for (const result of results) {
    const existing = seen.get(result.seasonId);
    if (!existing || result.competitionDate > existing.latest) seen.set(result.seasonId, { seasonId: result.seasonId, title: result.seasonTitle, year: result.seasonYear, latest: result.competitionDate });
  }
  return [...seen.values()].sort((a, b) => b.year - a.year || b.latest.localeCompare(a.latest)).map(({ seasonId, title, year }) => ({ seasonId, title, year }));
}

/** Highest publication version wins when a round has been published more than once. */
export function latestPerRound(results: TeamProfileHistoryResult[]): TeamProfileHistoryResult[] {
  const byRound = new Map<string, TeamProfileHistoryResult>();
  for (const result of results) {
    const existing = byRound.get(result.roundId);
    if (!existing || result.publicationVersion > existing.publicationVersion) byRound.set(result.roundId, result);
  }
  return [...byRound.values()];
}

export interface SeasonDetail { season: SeasonView; standing: StandingView | null }

/** Newest round first. Uses the season's rounds when they're known, so rounds the team skipped show as not entered. */
export function buildRows(results: TeamProfileHistoryResult[], detail: SeasonDetail | null): HistoryRow[] {
  const mine = latestPerRound(results);
  if (!detail) {
    return mine.map((result) => ({ key: result.roundId, order: result.roundOrder, name: result.competitionName, date: result.competitionDate, place: result.eventRank, points: result.seasonPoints, dropped: false }))
      .sort((a, b) => b.order - a.order);
  }
  const rounds = detail.season.rounds.filter((round) => round.isIncluded && (round.publishedVersion || mine.some((result) => result.roundId === round.id)));
  return rounds.map((round) => {
    const score = detail.standing?.rounds.find((item) => item.roundId === round.id);
    const result = mine.find((item) => item.roundId === round.id);
    if (score) return { key: round.id, order: round.orderIndex, name: round.competitionName, date: round.competitionDate, place: score.eventRank, points: score.seasonPoints, dropped: !score.counted };
    if (result) return { key: round.id, order: round.orderIndex, name: round.competitionName, date: round.competitionDate, place: result.eventRank, points: result.seasonPoints, dropped: false };
    return { key: round.id, order: round.orderIndex, name: round.competitionName, date: round.competitionDate, place: null, points: null, dropped: false };
  }).sort((a, b) => b.order - a.order);
}
