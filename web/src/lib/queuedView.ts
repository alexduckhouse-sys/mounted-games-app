import type { QueuedScore } from '../offline/scoreOutbox';
import type { Heat, ResultRow } from '../types';
import { lanesInUse } from './lanes';
import { manualPoints } from './raceScoring';

/** Points for a place, as the server scores it (see `ScoringService`): the heat's own rules, never changed here. */
export function pointsForPlace(heat: Heat, sessionBase: number, place: number, eliminated: boolean): number {
  if (eliminated) return 0;
  if (heat.raceRoundStage === 1) return 1;
  const letteredFinal = /^[A-Z] Final(?:\s*(?:[-·–]\s*)?(?:Part\s+)?\d+)?$/i.test(heat.label?.trim() ?? '');
  const base = heat.raceRoundStage === 2 ? heat.entries.length + 1
    : letteredFinal ? Math.min(sessionBase, Math.max(heat.entries.length, 1)) : sessionBase;
  return place < 1 || place > base ? 0 : base - place + 1;
}

/**
 * The heat as it will be once this phone's waiting saves have been sent: each queued race shows as complete with
 * those results, so the summary, the heat table and the next lanes don't wait for signal. Only for display.
 */
export function withQueuedResults(heat: Heat, queued: readonly QueuedScore[], sessionBase: number): Heat {
  const mine = queued.filter((q) => heat.races.some((r) => r.id === q.raceId));
  if (mine.length === 0) return heat;
  return {
    ...heat,
    races: heat.races.map((race) => {
      const q = mine.find((x) => x.raceId === race.id);
      if (!q) return race;
      const results = q.places.map((p): ResultRow => {
        const sitOut = !p.eliminated && p.place === 0;
        const tied = !p.eliminated && p.refereeNote?.toLowerCase().includes('[dead-heat]')
          ? q.places.filter((other) => !other.eliminated && other.place === p.place).length : 1;
        const placingPoints = tied > 1
          ? Math.round(Array.from({ length: tied }, (_, index) => pointsForPlace(heat, sessionBase, p.place + index, false)).reduce((sum, value) => sum + value, 0) / tied * 2) / 2
          : pointsForPlace(heat, sessionBase, p.place, p.eliminated);
        const directive = manualPoints(p.refereeNote);
        const adjustment = /\[adj:([+-]?[0-9]+(?:\.[0-9]+)?)\]/i.exec(p.refereeNote ?? '');
        const points = directive ?? (adjustment ? Math.max(0, placingPoints + Number(adjustment[1]))
          : p.eliminated ? 0 : manualPoints(undefined, p.points) ?? placingPoints);
        return {
          id: -p.teamId,
          teamId: p.teamId,
          teamName: q.teamNames[p.teamId] ?? `Team ${p.teamId}`,
          placing: p.eliminated || sitOut ? null : p.place,
          eliminated: p.eliminated,
          points: sitOut ? 0 : points,
          ...(sitOut ? { isSitOut: true } : {}),
          ...(p.eliminated ? { status: p.status } : {}),
        };
      });
      return { ...race, isComplete: true, results };
    }),
  };
}

/** The base used for points in a session: the largest field of lanes in any heat. */
export function sessionPointsBase(heats: readonly Heat[], lanesPerHeat?: number | null): number {
  return heats.reduce((most, h) => Math.max(most, lanesInUse(h.entries.length, lanesPerHeat)), 0);
}
