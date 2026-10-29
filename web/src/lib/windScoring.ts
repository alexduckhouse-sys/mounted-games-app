import { scoringDraftKey } from './raceScoring';
import type { Session } from '../types';

/** Keep earlier drafts on the phone without loading them into a replacement race. */
export function windDraftKey(heatId: number, raceId: number, revision = 0): string {
  const base = scoringDraftKey(heatId, raceId);
  return revision === 0 ? base : `${base}:programme:${revision}`;
}

/** Copy the whole programme when an organiser starts editing; live updates must not rebase the draft. */
export function sessionProgramme(session: Session) {
  return {
    plannedRaces: [...(session.plannedRaces ?? [])],
    heatIds: session.heats.map((heat) => heat.id),
    races: session.heats.flatMap((heat) => heat.races.map((race) => ({
      raceId: race.id, heatId: heat.id, orderIndex: race.orderIndex, name: race.name,
      programmeRevision: race.programmeRevision ?? 0,
    }))),
  };
}
