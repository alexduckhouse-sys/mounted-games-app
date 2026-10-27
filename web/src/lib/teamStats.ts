import type { Session } from '../types';

/** One time the team rode a race: where it came and what it scored. */
export interface RaceRun {
  /** Unique per result, for list keys. */
  key: string;
  /** The heat's own label, or "Heat 2"; for a final, the final's name ("A Final"). */
  where: string;
  isFinal: boolean;
  placing: number | null;
  eliminated: boolean;
  status?: number;
  points: number;
}

/** One race (a game such as "Mug Shuffle"), across every heat and final the team rode it in. */
export interface RaceStat {
  name: string;
  runs: RaceRun[];
  totalPoints: number;
  /** Points per run. */
  average: number;
  bestPlace: number | null;
}

export interface TeamStats {
  scoredRaces: number;
  totalPoints: number;
  avgPointsPerRace: number;
  avgPlace: number | null;
  racesWon: number;
  /** Points scored as a percentage of the points that were on offer in the races the team rode. */
  pointQuota: number;
  races: RaceStat[];
  /** The race with the highest average and the one with the lowest; null unless there are two or more to compare. */
  best: RaceStat | null;
  hardest: RaceStat | null;
}

const isRaceSession = (session: Session) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;

/**
 * What a team's scored races add up to: averages, races won, the point quota, and each race's runs in the order it first
 * came up. Sit-outs and races nobody has scored are left out. `raceName` and `heatName` supply the words for a race or
 * heat with no name of its own, so the caller decides the language.
 */
export function computeTeamStats(
  sessions: readonly Session[],
  teamId: number,
  raceName: (number: number) => string,
  heatName: (number: number) => string,
): TeamStats | null {
  let scoredRaces = 0;
  let totalPoints = 0;
  let maxAvailablePoints = 0;
  let placedFinishes = 0;
  let totalPlace = 0;
  let racesWon = 0;
  const byRace = new Map<string, RaceStat>();

  for (const session of sessions.filter(isRaceSession).sort((a, b) => a.orderIndex - b.orderIndex)) {
    const largestHeatSize = Math.max(1, ...session.heats.map((heat) => heat.entries.length), session.lanesPerHeat ?? 0);
    const heats = [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex);
    heats.forEach((heat, heatIndex) => {
      const heatMax = heat.raceRoundStage === 1 ? 1 : Math.max(heat.entries.length, largestHeatSize, 1);
      const isFinal = heat.raceRoundStage === 2 || /\bfinals?\b/i.test(heat.label ?? '') || /\bfinals?\b/i.test(session.name);
      const where = isFinal ? (heat.label?.trim() || session.name) : (heat.label?.trim() || heatName(heatIndex + 1));
      for (const race of heat.races) {
        if (!race.isComplete && race.results.length === 0) continue;
        const result = race.results.find((item) => item.teamId === teamId && !item.isSitOut);
        if (!result) continue;
        const raceMax = Math.max(heatMax, ...race.results.map((item) => item.points), 1);
        const placed = !result.eliminated && result.placing != null && result.placing > 0;
        scoredRaces += 1;
        totalPoints += result.points;
        maxAvailablePoints += raceMax;
        if (placed) {
          placedFinishes += 1;
          totalPlace += result.placing!;
          if (result.placing === 1) racesWon += 1;
        }
        const name = race.name.trim() || raceName(race.orderIndex + 1);
        const stat = byRace.get(name) ?? { name, runs: [], totalPoints: 0, average: 0, bestPlace: null };
        stat.runs.push({ key: `${race.id}-${result.id}`, where, isFinal, placing: result.placing, eliminated: result.eliminated, status: result.status, points: result.points });
        stat.totalPoints += result.points;
        if (placed) stat.bestPlace = stat.bestPlace == null ? result.placing! : Math.min(stat.bestPlace, result.placing!);
        byRace.set(name, stat);
      }
    });
  }

  if (scoredRaces === 0) return null;
  const races = [...byRace.values()].map((stat) => ({ ...stat, average: stat.totalPoints / stat.runs.length }));
  const ranked = [...races].sort((a, b) => b.average - a.average);
  return {
    scoredRaces,
    totalPoints,
    avgPointsPerRace: totalPoints / scoredRaces,
    avgPlace: placedFinishes > 0 ? totalPlace / placedFinishes : null,
    racesWon,
    pointQuota: maxAvailablePoints > 0 ? Math.round((totalPoints / maxAvailablePoints) * 100) : 0,
    races,
    best: races.length > 1 ? ranked[0] : null,
    hardest: races.length > 1 ? ranked[ranked.length - 1] : null,
  };
}
