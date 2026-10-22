import type { StatusTone } from '../refine/Refine';
import type { SeasonRoundView, StandingView } from './seasonViewTypes';

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
