import type { Race } from '../types';
import { formatPoints } from './formatPoints';

/** One team's line in the official standings, best first. */
export interface FactStanding { teamId: number; totalPoints: number; racesRun: number }

/** How many of the latest scored races in a row a team has won (0 when it won none, or the latest was not a win). */
export function winStreak(races: readonly Race[], teamId: number): number {
  const scored = races.filter((r) => r.isComplete).sort((a, b) => b.orderIndex - a.orderIndex);
  let streak = 0;
  for (const race of scored) {
    const result = race.results.find((r) => r.teamId === teamId);
    if (!result || result.eliminated || result.placing !== 1) break;
    streak += 1;
  }
  return streak;
}

/**
 * The one short line shown under a team while scoring: its streak in this heat and where it stands in the official
 * standings. Nothing is said about standing until a race has been run.
 */
export function commentatorFacts(teamIds: readonly number[], races: readonly Race[], standings: readonly FactStanding[]): Record<number, string> {
  const started = standings.some((s) => s.racesRun > 0);
  const leader = standings[0]?.totalPoints ?? 0;
  const out: Record<number, string> = {};
  for (const teamId of teamIds) {
    const streak = winStreak(races, teamId);
    const row = standings.findIndex((s) => s.teamId === teamId);
    const parts: string[] = [];
    if (streak >= 2) parts.push(`Won the last ${streak} races`);
    else if (streak === 1) parts.push('Won the last race');
    if (started && row === 0) parts.push('Leading');
    else if (started && row > 0) {
      const gap = leader - standings[row].totalPoints;
      if (gap > 0) parts.push(`${formatPoints(gap)} ${gap === 1 ? 'point' : 'points'} behind 1st`);
    }
    if (parts.length > 0) out[teamId] = parts.join(' · ');
  }
  return out;
}
