import type { StatusTone } from '../refine/Refine';
import type { SeasonRoundView, SeasonView, StandingView } from './seasonViewTypes';

export function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th'}`;
}

/** Tied teams share a rank; show those as "=3". */
export function positionLabels(standings: StandingView[]): Map<string, string> {
  const sizes = new Map<number, number>();
  for (const row of standings) sizes.set(row.rank, (sizes.get(row.rank) ?? 0) + 1);
  return new Map(standings.map((row) => [row.teamProfileId, (sizes.get(row.rank) ?? 0) > 1 ? `=${row.rank}` : String(row.rank)]));
}

export function roundDivision(round: SeasonRoundView, fallbackAgeGroup = ''): string {
  return round.ageGroup?.trim() || round.sectionName?.trim() || fallbackAgeGroup.trim() || 'All age groups';
}

export function seasonDivisions(rounds: SeasonRoundView[], fallbackAgeGroup = ''): string[] {
  const seen = new Set<string>();
  for (const round of rounds) {
    const div = roundDivision(round, fallbackAgeGroup);
    if (div && div.toLowerCase() !== 'all age groups') seen.add(div);
  }
  return [...seen];
}

export function filterStandingsByDivision(season: SeasonView, standings: StandingView[], division: string): StandingView[] {
  if (!division || division === 'all') return standings;
  const target = division.trim().toLowerCase();
  const roundOrder = new Map<string, number>();
  for (const round of season.rounds) {
    if (round.isIncluded && roundDivision(round, season.ageGroup).toLowerCase() === target) {
      roundOrder.set(round.id, round.orderIndex);
    }
  }
  const best = season.bestResultsToCount;
  const filtered: StandingView[] = [];
  for (const row of standings) {
    const matching = row.rounds.filter((r) => roundOrder.has(r.roundId));
    if (matching.length === 0) continue;
    const limit = best ?? matching.length;
    const countedIds = new Set(
      [...matching]
        .sort((a, b) => b.seasonPoints - a.seasonPoints || (roundOrder.get(a.roundId) ?? 0) - (roundOrder.get(b.roundId) ?? 0))
        .slice(0, limit)
        .map((r) => r.roundId),
    );
    const rounds = matching.map((r) => ({ ...r, counted: countedIds.has(r.roundId) }));
    const totalPoints = rounds.filter((r) => r.counted).reduce((sum, r) => sum + r.seasonPoints, 0);
    filtered.push({ ...row, rank: 0, totalPoints, rounds });
  }
  const wins = (row: StandingView) => row.rounds.filter((r) => r.eventRank === 1).length;
  filtered.sort((a, b) => b.totalPoints - a.totalPoints || wins(b) - wins(a) || a.teamName.localeCompare(b.teamName));
  let prevPoints: number | null = null;
  let prevWins: number | null = null;
  let rank = 0;
  return filtered.map((row, idx) => {
    const w = wins(row);
    if (prevPoints !== row.totalPoints || prevWins !== w) rank = idx + 1;
    prevPoints = row.totalPoints;
    prevWins = w;
    return { ...row, rank };
  });
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** Derived from what the API returns: publication state and the event date. There is no separate "live" flag. */
export function roundStatus(round: SeasonRoundView, now: Date = new Date()): { label: string; tone: StatusTone } {
  if (!round.isIncluded) return { label: 'Excluded', tone: 'mut' };
  if (round.publishedVersion) return round.publicationIsCurrent ? { label: 'Final', tone: 'mut' } : { label: 'Provisional', tone: 'warn' };
  const day = startOfDay(new Date(round.competitionDate));
  const today = startOfDay(now);
  if (day === today) return { label: 'LIVE', tone: 'live' };
  if (day > today) return { label: 'Upcoming', tone: 'mut' };
  return { label: 'Awaiting results', tone: 'mut' };
}

/** The latest included round that has published results. */
export function lastPublishedRound(rounds: SeasonRoundView[]): SeasonRoundView | null {
  const published = rounds.filter((round) => round.isIncluded && round.publishedVersion);
  return published.reduce<SeasonRoundView | null>((best, round) => (!best || round.orderIndex > best.orderIndex ? round : best), null);
}

export function shortDate(iso: string, withWeekday = true): string {
  return new Date(iso).toLocaleDateString('en-GB', { ...(withWeekday ? { weekday: 'short' as const } : {}), day: 'numeric', month: 'short' });
}
