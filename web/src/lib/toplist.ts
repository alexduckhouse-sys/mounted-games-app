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
  hc: { teamId: number; teamName: string; points: number; racesLeft: number }[];
  sessionsDone: number;
  sessionsTotal: number;
  /** Points per heat session in running order, then finals ("F") once they have points; `cells` follows `sessions`. */
  bySession: { sessions: { id: number; label: string; title: string }[]; cells: Map<number, number[]> };
  /** Each final that has results, in running order ("A Final", "B Final"...). Empty until a final has been ridden. */
  finals: FinalGroup[];
  /** What each team did, for the team sheet: qualifying standing, its final and its races per session. */
  detail: Map<number, TeamDetail>;
}

export interface FinalRow {
  teamId: number;
  teamName: string;
  /** Shared by tied teams, or null when the team has no result in this final yet. */
  place: number | null;
  points: number | null;
  /** Where the team stood in qualifying, ignoring finals points; null when qualifying has no points. */
  qualifyingPosition: number | null;
}

export interface FinalGroup {
  id: number;
  label: string;
  rows: FinalRow[];
  /** Each team's result in every race of the final. */
  races: Map<number, TeamRaceResult[]>;
}

export interface TeamRaceResult { id: number; name: string; placing: number | null; eliminated: boolean; points: number }

export interface TeamBlock {
  key: string;
  kind: 'final' | 'session';
  label: string;
  /** "not carried over" for a final, whose points are not added to the qualifying total. */
  note: string | null;
  /** Null when the team has no part in this session (it did not ride). */
  points: number | null;
  races: TeamRaceResult[];
}

export interface TeamDetail {
  teamId: number;
  teamName: string;
  qualifyingPosition: number | null;
  qualifyingPoints: number;
  final: { label: string; place: number | null; points: number | null } | null;
  /** Finals first, then qualifying sessions in running order. */
  blocks: TeamBlock[];
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

  const finalGroups = buildFinalGroups(sessions, sectionId);
  // Once finals exist the final a team is in (A, then B, then C) decides its place before points do.
  const tier = (row: StandingRow) => row.finalTier ?? Number.MAX_SAFE_INTEGER;
  const level = (a: StandingRow, b: StandingRow) => tier(a) === tier(b) && a.totalPoints === b.totalPoints;
  const ordered = [...standings].sort((a, b) => tier(a) - tier(b) || b.totalPoints - a.totalPoints);
  const rows: ToplistRow[] = ordered.map((row) => {
    const position = ordered.findIndex((other) => level(other, row)) + 1;
    const joint = ordered.filter((other) => level(other, row)).length > 1;
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
    .map((team) => ({ teamId: team.id, teamName: team.displayName, points: (sessionPoints.get(team.id) ?? []).reduce((sum, value) => sum + value, 0), racesLeft: racesLeft.get(team.id) ?? 0 }))
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
  const qualifying = qualifyingRanks(rows, sessionPoints);
  for (const group of finalGroups) for (const finalRow of group.rows) finalRow.qualifyingPosition = qualifying.get(finalRow.teamId)?.position ?? null;
  const detail = buildDetail(rows, finalGroups, heatSessions, qualifying);
  return { rows, cutAfter, runoff, hc, sessionsDone, sessionsTotal: heatSessions.length, bySession: { sessions: columns, cells }, finals: finalGroups, detail };
}

const finalWording = /\bfinals?\b/i;

/** One group per final heat that has results: teams by the points they scored in it, tied teams sharing a place. */
function buildFinalGroups(sessions: Session[], sectionId: number): FinalGroup[] {
  const groups: FinalGroup[] = [];
  const ordered = sessions
    .filter((session) => session.competitionSectionId === sectionId && isRace(session))
    .sort((a, b) => a.orderIndex - b.orderIndex);
  for (const session of ordered) {
    for (const heat of [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex)) {
      if (!isFinal(session, heat)) continue;
      const results = heat.races.flatMap((race) => race.results);
      if (results.length === 0) continue;
      const scored = new Map<number, { teamName: string; points: number }>();
      for (const result of results) {
        const known = scored.get(result.teamId);
        scored.set(result.teamId, { teamName: result.teamName, points: (known?.points ?? 0) + result.points });
      }
      const unscored = heat.entries.filter((entry) => !scored.has(entry.teamId));
      const ranked = [...scored].map(([teamId, value]) => ({ teamId, ...value })).sort((a, b) => b.points - a.points || a.teamName.localeCompare(b.teamName));
      const rows: FinalRow[] = ranked.map((item) => ({
        teamId: item.teamId,
        teamName: item.teamName,
        place: ranked.findIndex((other) => other.points === item.points) + 1,
        points: item.points,
        qualifyingPosition: null,
      }));
      for (const entry of unscored) rows.push({ teamId: entry.teamId, teamName: entry.teamName, place: null, points: null, qualifyingPosition: null });
      const named = heat.label?.trim() ?? '';
      const races = new Map<number, TeamRaceResult[]>();
      for (const race of heat.races) {
        for (const result of race.results) {
          races.set(result.teamId, [...(races.get(result.teamId) ?? []), { id: result.id, name: race.name, placing: result.placing, eliminated: result.eliminated, points: result.points }]);
        }
      }
      groups.push({ id: heat.id, label: finalWording.test(named) ? named : [session.name, named].filter(Boolean).join(' · '), rows, races });
    }
  }
  return groups;
}

/** Qualifying rank from heat points alone (finals excluded), shared by tied teams. Empty until someone has qualifying points. */
function qualifyingRanks(rows: ToplistRow[], sessionPoints: Map<number, number[]>): Map<number, { position: number; points: number }> {
  const totals = rows.map((row) => ({ teamId: row.teamId, points: (sessionPoints.get(row.teamId) ?? []).reduce((sum, value) => sum + value, 0) }));
  const ranks = new Map<number, { position: number; points: number }>();
  if (!totals.some((item) => item.points > 0)) return ranks;
  for (const item of totals) ranks.set(item.teamId, { position: totals.filter((other) => other.points > item.points).length + 1, points: item.points });
  return ranks;
}

function buildDetail(rows: ToplistRow[], finals: FinalGroup[], heatSessions: Session[], qualifying: Map<number, { position: number; points: number }>): Map<number, TeamDetail> {
  const names = new Map<number, string>(rows.map((row) => [row.teamId, row.teamName]));
  for (const group of finals) for (const finalRow of group.rows) if (!names.has(finalRow.teamId)) names.set(finalRow.teamId, finalRow.teamName);
  const detail = new Map<number, TeamDetail>();
  for (const [teamId, teamName] of names) {
    const blocks: TeamBlock[] = [];
    let final: TeamDetail['final'] = null;
    for (const group of finals) {
      const mine = group.rows.find((item) => item.teamId === teamId);
      if (!mine) continue;
      final ??= { label: group.label, place: mine.place, points: mine.points };
      blocks.push({ key: `final-${group.id}`, kind: 'final', label: group.label, note: 'not carried over', points: mine.points, races: group.races.get(teamId) ?? [] });
    }
    heatSessions.forEach((session, index) => {
      const heats = session.heats.filter((heat) => !isFinal(session, heat) && (heat.entries.some((entry) => entry.teamId === teamId) || heat.races.some((race) => race.results.some((result) => result.teamId === teamId))));
      const races: TeamRaceResult[] = heats.flatMap((heat) => heat.races).flatMap((race) =>
        race.results.filter((result) => result.teamId === teamId).map((result) => ({ id: result.id, name: race.name, placing: result.placing, eliminated: result.eliminated, points: result.points })));
      const labels = heats.map((heat) => heat.label?.trim()).filter(Boolean);
      blocks.push({
        key: `session-${session.id}`,
        kind: 'session',
        label: [`Session ${index + 1}`, ...labels].join(' · '),
        note: null,
        points: heats.length === 0 ? null : races.reduce((sum, race) => sum + race.points, 0),
        races,
      });
    });
    const rank = qualifying.get(teamId);
    detail.set(teamId, {
      teamId,
      teamName,
      qualifyingPosition: rank?.position ?? null,
      qualifyingPoints: rank?.points ?? 0,
      final,
      blocks,
    });
  }
  return detail;
}

/** The small line under a team's name, or null when there is nothing worth saying. */
export function toplistNote(row: ToplistRow): string | null {
  if (row.runoff) return `Joint ${ordinal(row.position)} · run-off`;
  if (row.needed != null) return `${row.needed} needed to make the final`;
  if (row.racesLeft > 0) return `${row.racesLeft} ${row.racesLeft === 1 ? 'race' : 'races'} left`;
  return null;
}
