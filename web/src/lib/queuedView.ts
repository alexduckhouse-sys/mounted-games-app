import type { QueuedScore } from '../offline/scoreOutbox';
import type { Heat, ResultRow } from '../types';
import { lanesInUse } from './lanes';
import { manualPoints } from './raceScoring';

/** Points for a place, as the server scores it (see `ScoringService`): the heat's own rules, never changed here. */
export function pointsForPlace(heat: Heat, sessionBase: number, place: number, eliminated: boolean): number {
  if (eliminated) return 0;
  if (heat.raceRoundStage === 1) return 1;
  const base = heat.raceRoundStage === 2 ? heat.entries.length + 1 : sessionBase;
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
        return {
          id: -p.teamId,
          teamId: p.teamId,
          teamName: q.teamNames[p.teamId] ?? `Team ${p.teamId}`,
          placing: p.eliminated || sitOut ? null : p.place,
          eliminated: p.eliminated,
          points: sitOut ? 0 : manualPoints(p.refereeNote) ?? pointsForPlace(heat, sessionBase, p.place, p.eliminated),
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
