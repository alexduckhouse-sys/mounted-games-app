import type { Heat, HeatEntry, Session } from '../types';

export interface LaneRow { lane: number; teamId: number; teamName: string; bibColour?: string | null }

/** Who is in which lane in the next part of the day. */
export interface NextLanes {
  title: string;
  /** Said under the title when the lanes are not final yet, or how they will move. */
  note: string | null;
  provisional: boolean;
  rows: LaneRow[];
}

const heatDone = (heat: Heat) => heat.races.length > 0 && heat.races.every((race) => race.isComplete);

const drawn = (entries: HeatEntry[]): LaneRow[] => entries.slice()
  .sort((a, b) => a.laneIndex - b.laneIndex || a.id - b.id)
  .map((e, i) => ({ lane: i + 1, teamId: e.teamId, teamName: e.teamName, bibColour: e.bibColour }));

/**
 * Qualifier teams in the order `RaceFinalService` fills the final: Q1 first, Q2 first, Q1 second, Q2 second and so on,
 * the top `qualifiers` of each by placing, up to the session's lanes. Hors concours teams are skipped, as on the server.
 */
function interleave(qualifierHeats: Heat[], qualifiers: number, lanes: number | null | undefined, hc: ReadonlySet<number>): LaneRow[] {
  const top = (heat: Heat) => heat.races.flatMap((r) => r.results)
    .filter((r) => !r.isSitOut && !r.eliminated && (r.placing ?? 0) > 0 && !hc.has(r.teamId))
    .sort((a, b) => a.placing! - b.placing!)
    .slice(0, qualifiers)
    .map((r) => ({ teamId: r.teamId, teamName: heat.entries.find((e) => e.teamId === r.teamId)?.teamName ?? r.teamName, bibColour: heat.entries.find((e) => e.teamId === r.teamId)?.bibColour }));
  const [q1, q2] = [top(qualifierHeats[0]), top(qualifierHeats[1])];
  const limit = lanes && lanes > 0 ? lanes : q1.length + q2.length;
  const picked: Omit<LaneRow, 'lane'>[] = [];
  for (let i = 0; i < qualifiers && picked.length < limit; i++) {
    if (q1[i] && picked.length < limit) picked.push(q1[i]);
    if (q2[i] && picked.length < limit) picked.push(q2[i]);
  }
  return picked.map((p, i) => ({ ...p, lane: i + 1 }));
}

/**
 * Heat-heat-final: once both qualifiers are scored, the final's lanes (the server's own once it has filled the final,
 * otherwise the same pick worked out here, marked provisional). Once the final is scored, the lanes of the next heat.
 * Null when there is nothing to announce.
 */
export function nextRoundLanes(session: Session, heat: Heat, nextHeat: Heat | null, qualifiers: number, hcTeamIds: ReadonlySet<number> = new Set()): NextLanes | null {
  const round = session.heats.filter((h) => h.raceRoundId != null && h.raceRoundId === heat.raceRoundId);
  const qualifierHeats = round.filter((h) => h.raceRoundStage === 1).sort((a, b) => a.orderIndex - b.orderIndex);
  const final = round.find((h) => h.raceRoundStage === 2);

  // Shown while a qualifier is on screen and, if the final has no teams yet, on the final's own page.
  const onFinalEmpty = heat.raceRoundStage === 2 && !heatDone(heat) && heat.entries.length === 0;
  if ((heat.raceRoundStage === 1 || onFinalEmpty) && final && qualifierHeats.length >= 2 && qualifierHeats.every(heatDone)) {
    const label = final.label ?? 'the final';
    if (final.entries.length > 0) return { title: `Lanes for ${label}`, note: null, provisional: false, rows: drawn(final.entries) };
    return {
      title: `Lanes for ${label}`,
      note: 'Provisional. The final is filled from the qualifiers once the results are saved, and the lanes can change.',
      provisional: true,
      rows: interleave(qualifierHeats, qualifiers, session.lanesPerHeat, hcTeamIds),
    };
  }

  if (heat.raceRoundStage === 2 && heatDone(heat) && nextHeat && nextHeat.entries.length > 0) {
    return {
      title: `Lanes for ${nextHeat.label ?? 'the next heat'}`,
      note: 'Starting lanes. They rotate after each race.',
      provisional: false,
      rows: drawn(nextHeat.entries),
    };
  }
  return null;
}
