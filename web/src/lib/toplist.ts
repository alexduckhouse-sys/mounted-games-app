import type { Heat, Session, StandingRow, Team } from '../types';

export interface ToplistRow {
  teamId: number;
  teamName: string;
  points: number;
  /** Shared by tied teams: 1, 2, 2, 4. */
  position: number;
  joint: boolean;
  /** Tied on the cut-off with places to share: decided by a run-off. */
  runoff: boolean;
  /** Below the final cut-off line. */
  out: boolean;
  /** Points to pass the last finalist, for teams below the line that still have races to ride. */
  needed: number | null;
  racesLeft: number;
}

export interface Toplist {
  rows: ToplistRow[];
  /** Index of the last row above the final cut-off line, or null when there is no line to draw. */
  cutAfter: number | null;
  runoff: { place: number; teams: ToplistRow[] } | null;
  hc: { teamId: number; teamName: string; points: number }[];
  sessionsDone: number;
  sessionsTotal: number;
  /** Points per heat session in running order, then finals ("F") once they have points; `cells` follows `sessions`. */
  bySession: { sessions: { id: number; label: string; title: string }[]; cells: Map<number, number[]> };
}

const isRace = (session: Session) => (session.kind ?? (session.isBreak ? 1 : 0)) === 0;
/** Same rule as the timetable: a final heat, or a session or heat named "final". */
const isFinal = (session: Session, heat: Heat) => heat.raceRoundStage === 2 || /\bfinals?\b/i.test(heat.label ?? '') || /\bfinals?\b/i.test(session.name);
const heatDone = (heat: Heat) => !!heat.finishedAt || (heat.races.length > 0 && heat.races.every((race) => race.isComplete));

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * The toplist for one age group: positions with ties, the final cut-off, any run-off at the line,
 * what each team still has to ride, hors concours teams and points per session.
 */
export function buildToplist(standings: StandingRow[], sessions: Session[], teams: Team[], sectionId: number, finalistCount: number | null | undefined): Toplist {
  const heatSessions = sessions
    .filter((session) => session.competitionSectionId === sectionId && isRace(session) && session.heats.some((heat) => !isFinal(session, heat)))
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const sessionsDone = heatSessions.filter((session) => session.status === 2 || (session.heats.length > 0 && session.heats.every(heatDone))).length;

  const racesLeft = new Map<number, number>();
  const sessionPoints = new Map<number, number[]>();
  const finalsPoints = new Map<number, number>();
  for (const session of sessions) {
    if (session.competitionSectionId !== sectionId || !isRace(session)) continue;
    for (const heat of session.heats.filter((item) => isFinal(session, item))) {
      for (const result of heat.races.flatMap((race) => race.results)) finalsPoints.set(result.teamId, (finalsPoints.get(result.teamId) ?? 0) + result.points);
    }
  }
  heatSessions.forEach((session, index) => {
    for (const heat of session.heats) {
      if (isFinal(session, heat)) continue;
      const open = heatDone(heat) ? 0 : heat.races.filter((race) => !race.isComplete).length;
      for (const entry of heat.entries) racesLeft.set(entry.teamId, (racesLeft.get(entry.teamId) ?? 0) + open);
      for (const race of heat.races) {
        for (const result of race.results) {
          const cells = sessionPoints.get(result.teamId) ?? heatSessions.map(() => 0);
          cells[index] += result.points;
          sessionPoints.set(result.teamId, cells);
        }
      }
    }
  });

  const ordered = [...standings].sort((a, b) => b.totalPoints - a.totalPoints);
  const rows: ToplistRow[] = ordered.map((row) => {
    const position = ordered.findIndex((other) => other.totalPoints === row.totalPoints) + 1;
    const joint = ordered.filter((other) => other.totalPoints === row.totalPoints).length > 1;
    return { teamId: row.teamId, teamName: row.teamName, points: row.totalPoints, position, joint, runoff: false, out: false, needed: null, racesLeft: racesLeft.get(row.teamId) ?? 0 };
  });

  // Until someone has scored, everyone is level and a cut-off line would mean nothing.
  const scored = rows.some((row) => row.points > 0);
  let cutAfter: number | null = null;
  let runoff: Toplist['runoff'] = null;
  const places = finalistCount ?? 0;
  if (scored && places > 0 && rows.length > places) {
    const linePoints = rows[places - 1].points;
    const tied = rows.filter((row) => row.points === linePoints);
    const lastTied = rows.lastIndexOf(tied[tied.length - 1]);
    if (lastTied >= places) {
      // The tie straddles the line, so the tied teams ride a run-off for the places left.
      tied.forEach((row) => { row.runoff = true; });
      runoff = { place: tied[0].position, teams: tied };
      cutAfter = lastTied;
    } else {
      cutAfter = places - 1;
    }
    rows.forEach((row, index) => {
      if (index <= cutAfter!) return;
      row.out = true;
      if (row.racesLeft > 0) row.needed = linePoints - row.points + 1;
    });
  }

  const hc = teams
    .filter((team) => team.isHorsConcours && team.competitionSectionId === sectionId)
    .map((team) => ({ teamId: team.id, teamName: team.displayName, points: (sessionPoints.get(team.id) ?? []).reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.points - a.points || a.teamName.localeCompare(b.teamName));

  // Totals include finals, so the session columns only add up with a finals column alongside.
  const columns = heatSessions.map((session, index) => ({ id: session.id, label: `S${index + 1}`, title: `Session ${index + 1}` }));
  const cells = new Map<number, number[]>();
  const withFinals = finalsPoints.size > 0;
  for (const teamId of new Set([...sessionPoints.keys(), ...finalsPoints.keys()])) {
    const row = sessionPoints.get(teamId) ?? heatSessions.map(() => 0);
    cells.set(teamId, withFinals ? [...row, finalsPoints.get(teamId) ?? 0] : row);
  }
  if (withFinals) columns.push({ id: -1, label: 'F', title: 'Finals' });
  return { rows, cutAfter, runoff, hc, sessionsDone, sessionsTotal: heatSessions.length, bySession: { sessions: columns, cells } };
}

/** The small line under a team's name, or null when there is nothing worth saying. */
export function toplistNote(row: ToplistRow): string | null {
  if (row.runoff) return `Joint ${ordinal(row.position)} · run-off`;
  if (row.needed != null) return `${row.needed} needed to make the final`;
  if (row.racesLeft > 0) return `${row.racesLeft} ${row.racesLeft === 1 ? 'race' : 'races'} left`;
  return null;
}
