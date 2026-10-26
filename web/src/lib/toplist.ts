import type { Heat, Session, StandingRow, Team } from '../types';
import { lanesInUse, sitsOut } from './lanes.ts';

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
  /** The bounded exact search could not prove a minimum; null must not imply elimination. */
  neededUnavailable?: boolean;
  /** Only a tie at the cut-off is possible under normal finishes. */
  neededForRunoff?: boolean;
  racesLeft: number;
  /** Withdrawn or no-show: what they scored stays, they ride no more. */
  withdrawn: boolean;
  /** Tack check bonus points, already in `points`. */
  bonus: number;
  /** Plain-English explanation when two adjacent teams share the same total points. */
  tieBreakReason?: string | null;
}

export interface Toplist {
  rows: ToplistRow[];
  /** Index of the last row above the final cut-off line, or null when there is no line to draw. */
  cutAfter: number | null;
  runoff: { place: number; teams: ToplistRow[] } | null;
  hc: { teamId: number; teamName: string; points: number; racesLeft: number }[];
  sessionsDone: number;
  sessionsTotal: number;
  /** False until a race in this age group has been scored: before that nobody has a real position. */
  started: boolean;
  /** Points per heat session in running order, then finals ("F") once they have points, then tack check bonus ("T") when any team has some; `cells` follows `sessions`. */
  bySession: { sessions: { id: number; label: string; title: string }[]; cells: Map<number, number[]> };
  /** Each final that has results, in running order ("A Final", "B Final"...). Empty until a final has been ridden. */
  finals: FinalGroup[];
  /** Per-game results across all heats in this section, grouped by game name. */
  byGame: GameStandingGroup[];
  /** What each team did, for the team sheet: qualifying standing, its final and its races per session. */
  detail: Map<number, TeamDetail>;
}

export interface GameStandingRow {
  teamId: number;
  teamName: string;
  heatLabel: string;
  placing: number | null;
  eliminated: boolean;
  isSitOut?: boolean;
  status?: number;
  points: number;
  position: number;
  joint: boolean;
}

export interface GameStandingGroup {
  name: string;
  rows: GameStandingRow[];
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
  /** Every race of the final is scored (or the heat is marked finished): its winners are champions. */
  complete?: boolean;
}

export interface TeamRaceResult { id: number; name: string; placing: number | null; eliminated: boolean; points: number; status?: number }

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
const isHhfRoundFinal = (session: Session, heat: Heat) =>
  heat.raceRoundStage === 2 && (heat.raceRoundId != null || session.heats.some((h) => h.raceRoundStage === 1));
/** Same rule as the timetable: a competition-end final heat, or a session or heat named "final" (excluding HHF round finals). */
const isFinal = (session: Session, heat: Heat) =>
  !isHhfRoundFinal(session, heat) && (heat.raceRoundStage === 2 || /\bfinals?\b/i.test(heat.label ?? '') || /\bfinals?\b/i.test(session.name));
const heatDone = (heat: Heat) => !!heat.finishedAt || (heat.races.length > 0 && heat.races.every((race) => race.isComplete));

function hhfRoundKey(heat: Heat, raceName?: string): string {
  if (heat.raceRoundId != null) return `id:${heat.raceRoundId}`;
  const prefix = (heat.label ?? '').split('·')[0]?.trim().toLowerCase();
  return `name:${(raceName ?? prefix ?? '').trim().toLowerCase()}`;
}

function hhfFinalistKeys(session: Session): Set<string> {
  const keys = new Set<string>();
  for (const heat of session.heats) {
    if (!isHhfRoundFinal(session, heat)) continue;
    for (const race of heat.races) {
      const rk = hhfRoundKey(heat, race.name);
      for (const result of race.results) {
        keys.add(`${rk}:${result.teamId}`);
      }
    }
  }
  return keys;
}

/**
 * Fingerprint of a section's race scores and heat assignments. Clock changes (`startedAt`/`finishedAt`) leave this unchanged.
 * Includes this section's race sessions plus any combined-scoring sessions so cross-section scores don't trigger false refreshes.
 */
export function sectionScoreVersion(sessions: Session[], sectionId: number | null | undefined): string {
  if (sectionId == null) return '';
  const parts: string[] = [];
  const raceSessions = sessions
    .filter((session) => {
      if (!isRace(session)) return false;
      const secId = (session as { sectionId?: number | null }).sectionId ?? session.competitionSectionId;
      if (secId === sectionId || secId == null) return true;
      return session.heats.some((h) => /\[scoring:/i.test(`${session.notes ?? ''} ${h.label ?? ''}`))
        || /\[scoring:/i.test(session.notes ?? '');
    })
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex);
  for (const session of raceSessions) {
    const heats = session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
    for (const heat of heats) {
      const entryIds = heat.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex).map((e) => e.teamId).join(',');
      parts.push(`h:${heat.id}:${heat.label ?? ''}:${heat.raceRoundStage ?? 0}:[${entryIds}]`);
      const races = heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
      for (const race of races) {
        const res = race.results
          .slice()
          .sort((a, b) => a.teamId - b.teamId)
          .map((r) => `${r.teamId}=${r.placing ?? ''}/${r.points}/${r.eliminated ? 1 : 0}/${r.status ?? ''}/${r.isSitOut ? 1 : 0}`)
          .join(',');
        parts.push(`r:${race.id}:${race.isComplete ? 1 : 0}:[${res}]`);
      }
    }
  }
  return parts.join('|');
}

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
    const finalistKeys = hhfFinalistKeys(session);
    for (const heat of session.heats) {
      if (isFinal(session, heat)) continue;
      const open = heatDone(heat) ? 0 : heat.races.filter((race) => !race.isComplete).length;
      for (const entry of heat.entries) racesLeft.set(entry.teamId, (racesLeft.get(entry.teamId) ?? 0) + open);
      for (const race of heat.races) {
        const rk = heat.raceRoundStage === 1 ? hhfRoundKey(heat, race.name) : null;
        for (const result of race.results) {
          if (rk && finalistKeys.has(`${rk}:${result.teamId}`)) continue;
          const cells = sessionPoints.get(result.teamId) ?? heatSessions.map(() => 0);
          cells[index] += result.points;
          sessionPoints.set(result.teamId, cells);
        }
      }
    }
  });

  const tieFacts = buildTieBreakFacts(sessions, sectionId);
  // Once finals exist the final a team is in (A, then B, then C) decides its place before points do.
  const tier = (row: StandingRow) => row.finalTier ?? Number.MAX_SAFE_INTEGER;
  const compareRows = (a: StandingRow, b: StandingRow) =>
    tier(a) - tier(b) || b.totalPoints - a.totalPoints || compareTieBreak(a, b, tier(a) < Number.MAX_SAFE_INTEGER, finalsPoints, tieFacts);
  const level = (a: StandingRow, b: StandingRow) => compareRows(a, b) === 0;
  const ordered = [...standings].sort(compareRows);
  const standingRank = new Map(ordered.map((row, idx) => [row.teamId, (row as { place?: number }).place ?? idx + 1]));
  const finalGroups = buildFinalGroups(sessions, sectionId, standingRank);
  const hasRaceResults = sessions.some((session) => session.competitionSectionId === sectionId && isRace(session)
    && session.heats.some((heat) => heat.races.some((race) => race.results.length > 0)));
  const rows: ToplistRow[] = ordered.map((row, idx) => {
    const position = ordered.findIndex((other) => level(other, row)) + 1;
    const joint = ordered.filter((other) => level(other, row)).length > 1;
    let tieBreakReason: string | null = row.tieBreakReason ?? null;
    if (!tieBreakReason && (row.totalPoints > 0 || hasRaceResults)) {
      const next = ordered[idx + 1];
      const prev = idx > 0 ? ordered[idx - 1] : undefined;
      if (next && tier(row) === tier(next) && (row.totalPoints === next.totalPoints || Math.abs(row.totalPoints - next.totalPoints) < 0.1)) {
        tieBreakReason = !hasRaceResults && row.tieBreakOrder == null && next.tieBreakOrder == null && (row.wins ?? 0) === (next.wins ?? 0) && row.totalPoints === next.totalPoints
          ? 'Level on points and countback — run-off if on cut-off'
          : explainTieBreak(row, next, sessions, sectionId);
      } else if (prev && level(prev, row)) {
        const prevReason = prev.tieBreakReason
          ?? (!hasRaceResults && prev.tieBreakOrder == null && row.tieBreakOrder == null && (prev.wins ?? 0) === (row.wins ?? 0)
            ? 'Level on points and countback — run-off if on cut-off'
            : explainTieBreak(prev, row, sessions, sectionId));
        if (prevReason === 'Level on points and countback — run-off if on cut-off') {
          tieBreakReason = prevReason;
        }
      }
    }
    return { teamId: row.teamId, teamName: row.teamName, points: row.totalPoints, position, joint, runoff: false, out: false, needed: null, racesLeft: racesLeft.get(row.teamId) ?? 0, withdrawn: row.withdrawn === true, bonus: row.bonusPoints ?? 0, tieBreakReason };
  });

  const hcTeams = teams.filter((team) => team.isHorsConcours && team.competitionSectionId === sectionId);
  const hcTeamIds = new Set(hcTeams.map((team) => team.id));

  // Until someone has scored, everyone is level and a cut-off line would mean nothing.
  const scored = rows.some((row) => row.points > 0);
  let cutAfter: number | null = null;
  let runoff: Toplist['runoff'] = null;
  const hasFinals = finalGroups.length > 0 || ordered.some((row) => row.finalTier != null);
  const defaultPlaces = !hasFinals ? (heatSessions.find((s) => (s.lanesPerHeat ?? 0) > 0)?.lanesPerHeat ?? 6) : 0;
  const places = finalistCount === 0 ? 0 : (finalistCount ?? defaultPlaces);
  if (scored && places > 0 && rows.length > places) {
    const linePoints = rows[places - 1].points;
    const linePosition = rows[places - 1].position;
    const tied = rows.filter((row) => row.position === linePosition);
    const lastTied = rows.lastIndexOf(tied[tied.length - 1]);
    if (lastTied >= places) {
      // The tie straddles the line, so the tied teams ride a run-off for the places left.
      tied.forEach((row) => { row.runoff = true; });
      runoff = { place: tied[0].position, teams: tied };
      cutAfter = lastTied;
    } else {
      cutAfter = places - 1;
    }
    assignPointsNeeded(rows, cutAfter, places, linePoints, heatSessions, hcTeamIds);
  }

  const hc = hcTeams
    .map((team) => ({ teamId: team.id, teamName: team.displayName, points: (sessionPoints.get(team.id) ?? []).reduce((sum, value) => sum + value, 0), racesLeft: racesLeft.get(team.id) ?? 0 }))
    .sort((a, b) => b.points - a.points || a.teamName.localeCompare(b.teamName));

  // Totals include finals and tack check bonus points, so the session columns only add up with those alongside.
  const columns = heatSessions.map((session, index) => ({ id: session.id, label: `S${index + 1}`, title: `Session ${index + 1}` }));
  const cells = new Map<number, number[]>();
  const withFinals = finalsPoints.size > 0;
  const bonus = new Map(rows.filter((row) => row.bonus > 0).map((row) => [row.teamId, row.bonus]));
  for (const teamId of new Set([...sessionPoints.keys(), ...finalsPoints.keys(), ...bonus.keys()])) {
    const row = sessionPoints.get(teamId) ?? heatSessions.map(() => 0);
    const withF = withFinals ? [...row, finalsPoints.get(teamId) ?? 0] : row;
    cells.set(teamId, bonus.size > 0 ? [...withF, bonus.get(teamId) ?? 0] : withF);
  }
  if (withFinals) columns.push({ id: -1, label: 'F', title: 'Finals' });
  if (bonus.size > 0) columns.push({ id: -2, label: 'T', title: 'Tack check bonus points' });
  const qualifying = qualifyingRanks(rows, sessionPoints);
  for (const group of finalGroups) for (const finalRow of group.rows) finalRow.qualifyingPosition = qualifying.get(finalRow.teamId)?.position ?? null;
  const detail = buildDetail(rows, finalGroups, heatSessions, qualifying);
  const byGame = buildByGame(heatSessions, hcTeamIds);
  const started = scored || sessions.some((session) => session.competitionSectionId === sectionId && isRace(session)
    && session.heats.some((heat) => heat.races.some((race) => race.results.length > 0)));
  return { rows, cutAfter, runoff, hc, sessionsDone, sessionsTotal: heatSessions.length, started, bySession: { sessions: columns, cells }, finals: finalGroups, byGame, detail };
}

/**
 * Minimum under normal, slot-conserving finishes, not a forecast of eliminations or manual awards.
 * Search every legal allocation, memoising failed race-boundary states. This is exponential in the
 * remaining races/field size, so one shared work budget bounds the whole toplist, not each team.
 * Exhausting it is an explicit unknown, never a proof of elimination or an approximate minimum.
 */
function assignPointsNeeded(
  rows: ToplistRow[], cutAfter: number, places: number, linePoints: number,
  heatSessions: Session[], hcTeamIds: Set<number>,
) {
  const withdrawnIds = new Set(rows.filter((row) => row.withdrawn).map((row) => row.teamId));
  const rowIndex = new Map(rows.map((row, index) => [row.teamId, index]));
  const races: { entrants: number[]; slots: number[] }[] = [];
  for (const session of heatSessions) {
    // The API counts HC and withdrawn entries in the session base too. Historic manual awards
    // do not change the points available in an unscored race.
    const base = Math.max(1, ...session.heats.map((heat) => lanesInUse(heat.entries.length, session.lanesPerHeat)));
    for (const heat of session.heats) {
      if (isFinal(session, heat) || heatDone(heat)) continue;
      const entries = [...heat.entries].sort((a, b) => a.laneIndex - b.laneIndex || a.id - b.id);
      const orderedRaces = [...heat.races].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
      orderedRaces.forEach((race, raceIndex) => {
        if (race.isComplete) return;
        const entrants = entries.filter((entry, drawnIndex) => !withdrawnIds.has(entry.teamId) && !hcTeamIds.has(entry.teamId)
          && !sitsOut(drawnIndex + 1, raceIndex, entries.length, session.lanesPerHeat, session.laneRotationMode)
          && !race.results.some((result) => result.teamId === entry.teamId && result.isSitOut))
          // The API skips HC placings. HC still counts in the session base above.
          .map((entry) => rowIndex.get(entry.teamId) ?? -1);
        if (entrants.length) races.push({ entrants, slots: entrants.map((_, index) => heat.raceRoundStage === 1 ? 1 : base - index) });
      });
    }
  }

  const maxGain = rows.map((_, index) => races.reduce((sum, race) => sum + (race.entrants.includes(index) ? race.slots[0] : 0), 0));
  // Count slot visits, including failed partial assignments (not just completed permutations).
  // The structural limit also bounds recursion depth and the suffix-bound tables.
  let workLeft = 30_000;
  const tooLarge = rows.length > 100 || races.reduce((sum, race) => sum + race.entrants.length + 1, 0) > 500;
  type SearchResult = boolean | 'unavailable';

  function feasible(candidate: number, gain: number, allowTie: boolean): SearchResult {
    if (tooLarge || workLeft <= 0) return 'unavailable';
    const target = rows[candidate].points + gain;
    const points = rows.map((row) => row.points);
    // Ride candidate races first to reject unattainable gains before branching on other heats.
    const ordered = [...races].sort((a, b) => Number(b.entrants.includes(candidate)) - Number(a.entrants.includes(candidate)));
    const minimum = Array.from({ length: ordered.length + 1 }, () => rows.map(() => 0));
    const maximum = Array.from({ length: ordered.length + 1 }, () => 0);
    for (let index = ordered.length - 1; index >= 0; index--) {
      minimum[index] = [...minimum[index + 1]];
      maximum[index] = maximum[index + 1];
      const race = ordered[index];
      for (const entrant of race.entrants) if (entrant >= 0) minimum[index][entrant] += race.slots[race.slots.length - 1];
      if (race.entrants.includes(candidate)) maximum[index] += race.slots[0];
    }
    const failed = new Set<string>();
    const threatens = (value: number) => allowTie ? value > target : value >= target;

    function visit(index: number): SearchResult {
      if (--workLeft < 0) return 'unavailable';
      if (points[candidate] + minimum[index][candidate] > target || points[candidate] + maximum[index] < target) return false;
      let threats = 0;
      for (let rival = 0; rival < rows.length; rival++) {
        if (rival !== candidate && threatens(points[rival] + minimum[index][rival])) threats++;
      }
      if (threats >= places) return false;
      if (index === ordered.length) return true;
      // Once a rival reaches the threshold its precise excess cannot affect qualification.
      const key = `${index}:${points.map((value, rival) => rival === candidate ? value : Math.min(value, target + (allowTie ? 0.5 : 0))).join(',')}`;
      if (failed.has(key)) return false;
      const race = ordered[index];
      const entrants = [...race.entrants].sort((a, b) => a === candidate ? -1 : b === candidate ? 1
        : a < 0 ? 1 : b < 0 ? -1 : points[b] - points[a]);
      const available = [...race.slots];

      function assign(position: number): SearchResult {
        if (--workLeft < 0) return 'unavailable';
        // Unranked entrants are last. They absorb all remaining slots in any order.
        if (position === entrants.length || entrants[position] < 0) return visit(index + 1);
        const entrant = entrants[position];
        const choices = available.map((slot, slotIndex) => ({ slot, slotIndex }));
        if (entrant === candidate) choices.sort((a, b) => a.slot - b.slot);
        else choices.sort((a, b) => Number(threatens(points[entrant] + a.slot)) - Number(threatens(points[entrant] + b.slot)) || b.slot - a.slot);
        let previous = -1;
        for (const { slot, slotIndex } of choices) {
          if (slot === previous) continue; // qualifier races have identical one-point slots
          previous = slot;
          if (entrant === candidate && (points[entrant] + slot + minimum[index + 1][candidate] > target
            || points[entrant] + slot + maximum[index + 1] < target)) continue;
          available.splice(slotIndex, 1);
          points[entrant] += slot;
          const result = assign(position + 1);
          points[entrant] -= slot;
          available.splice(slotIndex, 0, slot);
          if (result !== false) return result;
        }
        return false;
      }
      const result = assign(0);
      if (result === false) failed.add(key);
      return result;
    }
    return visit(0);
  }

  rows.forEach((row, index) => {
    if (index <= cutAfter) return;
    row.out = true;
    if (row.racesLeft <= 0 || row.withdrawn || row.points + maxGain[index] < linePoints) return;
    // Future normal awards are integers; current totals can contain half points.
    // Prefer the minimum for an outright place, retaining run-off only when no outright place exists.
    for (const allowTie of [false, true]) {
      const first = allowTie ? Math.max(0, Math.ceil(linePoints - row.points)) : Math.max(0, Math.floor(linePoints - row.points) + 1);
      for (let gain = first; gain <= maxGain[index]; gain++) {
        const result = feasible(index, gain, allowTie);
        if (result === 'unavailable') { row.neededUnavailable = true; return; }
        if (result) {
          row.needed = gain;
          if (allowTie) row.neededForRunoff = true;
          return;
        }
      }
    }
  });
}

function buildByGame(heatSessions: Session[], hcTeamIds: Set<number>): GameStandingGroup[] {
  const groups = new Map<string, { name: string; raw: Omit<GameStandingRow, 'position' | 'joint'>[] }>();
  const multiSession = heatSessions.length > 1;
  heatSessions.forEach((session, sIdx) => {
    const heats = [...session.heats].filter((heat) => !isFinal(session, heat)).sort((a, b) => a.orderIndex - b.orderIndex);
    heats.forEach((heat, hIdx) => {
      const baseHeatLabel = heat.label?.trim() || `Heat ${hIdx + 1}`;
      const heatLabel = multiSession ? `S${sIdx + 1} · ${baseHeatLabel}` : baseHeatLabel;
      const races = [...heat.races].sort((a, b) => a.orderIndex - b.orderIndex);
      for (const race of races) {
        const displayName = race.name.trim();
        if (!displayName || race.results.length === 0) continue;
        const key = displayName.toLowerCase();
        let group = groups.get(key);
        if (!group) {
          group = { name: displayName, raw: [] };
          groups.set(key, group);
        }
        for (const result of race.results) {
          if (hcTeamIds.has(result.teamId)) continue;
          group.raw.push({
            teamId: result.teamId,
            teamName: result.teamName,
            heatLabel,
            placing: result.placing,
            eliminated: result.eliminated,
            isSitOut: result.isSitOut,
            status: result.status,
            points: result.points,
          });
        }
      }
    });
  });
  const out: GameStandingGroup[] = [];
  for (const group of groups.values()) {
    if (group.raw.length === 0) continue;
    const sorted = [...group.raw].sort(
      (a, b) => b.points - a.points || (a.placing ?? 999) - (b.placing ?? 999) || a.teamName.localeCompare(b.teamName),
    );
    const rows: GameStandingRow[] = sorted.map((item) => {
      const position = sorted.findIndex((other) => other.points === item.points) + 1;
      const joint = sorted.filter((other) => other.points === item.points).length > 1;
      return { ...item, position, joint };
    });
    out.push({ name: group.name, rows });
  }
  return out;
}

const finalWording = /\bfinals?\b/i;

/** One group per final heat that has results: teams by the points they scored in it, tied teams sharing a place. */
function buildFinalGroups(sessions: Session[], sectionId: number, standingRank?: Map<number, number>): FinalGroup[] {
  const groups: FinalGroup[] = [];
  const rankOf = (teamId: number) => standingRank?.get(teamId) ?? Number.MAX_SAFE_INTEGER;
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
      const ranked = [...scored]
        .map(([teamId, value]) => ({ teamId, ...value }))
        .sort((a, b) => b.points - a.points || rankOf(a.teamId) - rankOf(b.teamId) || a.teamName.localeCompare(b.teamName));
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
          races.set(result.teamId, [...(races.get(result.teamId) ?? []), { id: result.id, name: race.name, placing: result.placing, eliminated: result.eliminated, points: result.points, status: result.status }]);
        }
      }
      groups.push({ id: heat.id, label: finalWording.test(named) ? named : [session.name, named].filter(Boolean).join(' · '), rows, races, complete: heatDone(heat) });
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

interface TeamTieBreakFacts {
  placingCounts: number[];
  recentPoints: number[];
  finalPlacingCounts: number[];
  finalRecentPoints: number[];
}

function buildTieBreakFacts(sessions: Session[], sectionId: number): Map<number, TeamTieBreakFacts> {
  const facts = new Map<number, TeamTieBreakFacts>();
  const ensure = (teamId: number): TeamTieBreakFacts => {
    let f = facts.get(teamId);
    if (!f) {
      f = { placingCounts: Array(10).fill(0), recentPoints: [], finalPlacingCounts: Array(10).fill(0), finalRecentPoints: [] };
      facts.set(teamId, f);
    }
    return f;
  };
  const orderedSessions = sessions
    .filter((s) => s.competitionSectionId === sectionId && isRace(s))
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
  for (const session of orderedSessions) {
    const finalistKeys = hhfFinalistKeys(session);
    const heats = session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
    for (const heat of heats) {
      const inFinal = isFinal(session, heat);
      const races = heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
      for (const race of races) {
        const rk = heat.raceRoundStage === 1 ? hhfRoundKey(heat, race.name) : null;
        for (const result of race.results) {
          if (result.isSitOut) continue;
          if (rk && finalistKeys.has(`${rk}:${result.teamId}`)) continue;
          const f = ensure(result.teamId);
          if (inFinal) {
            if (!result.eliminated && (result.placing ?? 0) >= 1 && (result.placing ?? 0) <= 10) {
              f.finalPlacingCounts[(result.placing ?? 1) - 1]++;
            }
            f.finalRecentPoints.unshift(result.points);
          }
          if (!result.eliminated && (result.placing ?? 0) >= 1 && (result.placing ?? 0) <= 10) {
            f.placingCounts[(result.placing ?? 1) - 1]++;
          }
          f.recentPoints.unshift(result.points);
        }
      }
    }
  }
  return facts;
}

type TieBreakRow = StandingRow & {
  tieBreakOrder?: number | null;
  finalsTieOrder?: number | null;
  finalPlace?: number | null;
  place?: number | null;
};

function compareTieBreak(
  aRow: StandingRow,
  bRow: StandingRow,
  inFinal: boolean,
  finalsPoints: Map<number, number>,
  facts: Map<number, TeamTieBreakFacts>,
): number {
  const a = aRow as TieBreakRow;
  const b = bRow as TieBreakRow;
  if (a.finalsTieOrder != null && b.finalsTieOrder != null && a.finalsTieOrder !== b.finalsTieOrder) return a.finalsTieOrder - b.finalsTieOrder;
  if (a.tieBreakOrder != null && b.tieBreakOrder != null && a.tieBreakOrder !== b.tieBreakOrder) return a.tieBreakOrder - b.tieBreakOrder;
  if (a.finalPlace != null && b.finalPlace != null && a.finalPlace !== b.finalPlace) return a.finalPlace - b.finalPlace;
  if (a.place != null && b.place != null && a.place !== b.place) return a.place - b.place;
  const fa = facts.get(a.teamId);
  const fb = facts.get(b.teamId);
  if (inFinal) {
    const aFp = a.finalPoints ?? finalsPoints.get(a.teamId);
    const bFp = b.finalPoints ?? finalsPoints.get(b.teamId);
    if (aFp != null && bFp != null && aFp !== bFp) return bFp - aFp;
    if (fa && fb) {
      for (let i = 0; i < 10; i++) {
        if (fa.finalPlacingCounts[i] !== fb.finalPlacingCounts[i]) return fb.finalPlacingCounts[i] - fa.finalPlacingCounts[i];
      }
      for (let i = 0; i < Math.min(fa.finalRecentPoints.length, fb.finalRecentPoints.length); i++) {
        if (fa.finalRecentPoints[i] !== fb.finalRecentPoints[i]) return fb.finalRecentPoints[i] - fa.finalRecentPoints[i];
      }
    }
  }
  if (a.wins !== b.wins) return b.wins - a.wins;
  if (fa && fb) {
    for (let i = 0; i < 10; i++) {
      if (fa.placingCounts[i] !== fb.placingCounts[i]) return fb.placingCounts[i] - fa.placingCounts[i];
    }
    for (let i = 0; i < Math.min(fa.recentPoints.length, fb.recentPoints.length); i++) {
      if (fa.recentPoints[i] !== fb.recentPoints[i]) return fb.recentPoints[i] - fa.recentPoints[i];
    }
  }
  return 0;
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
      const finalistKeys = hhfFinalistKeys(session);
      const heats = session.heats.filter((heat) => !isFinal(session, heat) && (heat.entries.some((entry) => entry.teamId === teamId) || heat.races.some((race) => race.results.some((result) => result.teamId === teamId))));
      const races: TeamRaceResult[] = [];
      let sessionTotal = 0;
      for (const heat of heats) {
        for (const race of heat.races) {
          const rk = heat.raceRoundStage === 1 ? hhfRoundKey(heat, race.name) : null;
          for (const result of race.results) {
            if (result.teamId !== teamId) continue;
            races.push({ id: result.id, name: race.name, placing: result.placing, eliminated: result.eliminated, points: result.points, status: result.status });
            if (!(rk && finalistKeys.has(`${rk}:${teamId}`))) {
              sessionTotal += result.points;
            }
          }
        }
      }
      const labels = heats.map((heat) => heat.label?.trim()).filter(Boolean);
      blocks.push({
        key: `session-${session.id}`,
        kind: 'session',
        label: [`Session ${index + 1}`, ...labels].join(' · '),
        note: null,
        points: heats.length === 0 ? null : sessionTotal,
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

/**
 * Computes a concise, human-readable tie-break explanation whenever two adjacent teams share the same total points.
 */
export function explainTieBreak(
  above: StandingRow,
  below: StandingRow,
  sessions: Session[],
  sectionId: number,
): string | null {
  if (above.tieBreakReason) return above.tieBreakReason;
  if (Math.abs(above.totalPoints - below.totalPoints) >= 0.1) return null;
  if (Math.abs(above.totalPoints - below.totalPoints) > 0 && Math.abs(above.totalPoints - below.totalPoints) < 0.1) {
    return 'Settled by run-off / referee order';
  }
  if (above.tieBreakOrder != null && below.tieBreakOrder != null && above.tieBreakOrder !== below.tieBreakOrder) {
    return 'Settled by run-off / referee order';
  }
  if (above.totalPoints <= 0 && (above.racesRun ?? 0) === 0 && (below.racesRun ?? 0) === 0) {
    const anyScored = sessions.some((s) => s.competitionSectionId === sectionId && isRace(s)
      && s.heats.some((h) => h.races.some((r) => r.results.length > 0)));
    if (!anyScored) return null;
  }

  const sectionSessions = sessions
    .filter((s) => s.competitionSectionId === sectionId && isRace(s))
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const allRaces: { isFinalHeat: boolean; raceName: string; aboveRes?: { placing: number | null; points: number; eliminated: boolean }; belowRes?: { placing: number | null; points: number; eliminated: boolean } }[] = [];
  for (const session of sectionSessions) {
    const heats = [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex);
    for (const heat of heats) {
      const finalHeat = isFinal(session, heat);
      const races = [...heat.races].sort((a, b) => a.orderIndex - b.orderIndex);
      for (const race of races) {
        if (race.results.length === 0) continue;
        const aboveRes = race.results.find((r) => r.teamId === above.teamId);
        const belowRes = race.results.find((r) => r.teamId === below.teamId);
        if (aboveRes || belowRes) {
          allRaces.push({ isFinalHeat: finalHeat, raceName: race.name, aboveRes, belowRes });
        }
      }
    }
  }

  // 1. Check lettered / final heat results first when both competed in a final
  const finalRaces = allRaces.filter((r) => r.isFinalHeat && (r.aboveRes || r.belowRes));
  if (finalRaces.some((r) => r.aboveRes) && finalRaces.some((r) => r.belowRes)) {
    const aFinalPts = finalRaces.reduce((sum, r) => sum + (r.aboveRes?.points ?? 0), 0);
    const bFinalPts = finalRaces.reduce((sum, r) => sum + (r.belowRes?.points ?? 0), 0);
    if (aFinalPts !== bFinalPts) {
      return 'Ahead on A-Final placing';
    }
    const maxFinalPlace = Math.max(
      0,
      ...finalRaces.flatMap((r) => [
        !r.aboveRes?.eliminated && (r.aboveRes?.placing ?? 0) > 0 ? r.aboveRes!.placing! : 0,
        !r.belowRes?.eliminated && (r.belowRes?.placing ?? 0) > 0 ? r.belowRes!.placing! : 0,
      ]),
    );
    for (let place = 1; place <= maxFinalPlace; place++) {
      const aCount = finalRaces.filter((r) => !r.aboveRes?.eliminated && r.aboveRes?.placing === place).length;
      const bCount = finalRaces.filter((r) => !r.belowRes?.eliminated && r.belowRes?.placing === place).length;
      if (aCount !== bCount) return 'Ahead on A-Final placing';
    }
  }

  // 2. Countback across all race results (or StandingRow.wins when sessions aren't passed)
  const maxPlace = Math.max(
    0,
    ...allRaces.flatMap((r) => [
      !r.aboveRes?.eliminated && (r.aboveRes?.placing ?? 0) > 0 ? r.aboveRes!.placing! : 0,
      !r.belowRes?.eliminated && (r.belowRes?.placing ?? 0) > 0 ? r.belowRes!.placing! : 0,
    ]),
  );

  let countbackFavoursBelow = false;
  if (maxPlace > 0) {
    for (let place = 1; place <= maxPlace; place++) {
      const aCount = allRaces.filter((r) => !r.aboveRes?.eliminated && r.aboveRes?.placing === place).length;
      const bCount = allRaces.filter((r) => !r.belowRes?.eliminated && r.belowRes?.placing === place).length;
      if (aCount === bCount) continue;
      if (aCount > bCount) {
        const aWord = aCount === 1 ? 'place' : 'places';
        const bWord = bCount === 1 ? 'place' : 'places';
        return `Ahead of ${below.teamName} on Countback (${aCount}× ${ordinal(place)} ${aWord} vs ${bCount}× ${ordinal(place)} ${bWord})`;
      }
      countbackFavoursBelow = true;
      break;
    }
  } else if ((above.wins ?? 0) !== (below.wins ?? 0)) {
    const aWins = above.wins ?? 0;
    const bWins = below.wins ?? 0;
    if (aWins > bWins) {
      const aWord = aWins === 1 ? 'place' : 'places';
      const bWord = bWins === 1 ? 'place' : 'places';
      return `Ahead of ${below.teamName} on Countback (${aWins}× 1st ${aWord} vs ${bWins}× 1st ${bWord})`;
    }
    countbackFavoursBelow = true;
  }

  // 3. Check Last Race when both competed in a recent race
  for (let i = allRaces.length - 1; i >= 0; i--) {
    const { raceName, aboveRes, belowRes } = allRaces[i];
    if (!aboveRes || !belowRes) continue;
    const aPlace = !aboveRes.eliminated && aboveRes.placing != null && aboveRes.placing > 0 ? aboveRes.placing : null;
    const bPlace = !belowRes.eliminated && belowRes.placing != null && belowRes.placing > 0 ? belowRes.placing : null;
    if (aPlace === bPlace && aboveRes.points === belowRes.points) continue;
    const aboveBetter = (aPlace != null && bPlace != null && aPlace < bPlace)
      || (aPlace != null && bPlace == null)
      || aboveRes.points > belowRes.points;
    if (aboveBetter) {
      const aDesc = aPlace != null ? ordinal(aPlace) : `${aboveRes.points} pts`;
      const bDesc = bPlace != null ? ordinal(bPlace) : belowRes.eliminated ? 'elim.' : `${belowRes.points} pts`;
      return `Ahead on Last Race (${aDesc} in ${raceName} vs ${bDesc})`;
    }
    break;
  }

  if (countbackFavoursBelow) {
    return 'Settled by run-off / referee order';
  }

  return 'Level on points and countback — run-off if on cut-off';
}

/** The small line under a team's name, or null when there is nothing worth saying. */
export function toplistNote(row: ToplistRow): string | null {
  const tack = row.bonus > 0 ? `${row.bonus} tack bonus ${row.bonus === 1 ? 'point' : 'points'}` : null;
  const tie = !row.withdrawn && !row.runoff ? row.tieBreakReason ?? null : null;
  return [standingNote(row), tie, tack].filter(Boolean).join(' · ') || null;
}

function standingNote(row: ToplistRow): string | null {
  if (row.withdrawn) return 'Withdrawn';
  if (row.runoff) return `Joint ${ordinal(row.position)} · run-off`;
  if (row.neededUnavailable) return 'Qualification calculation unavailable';
  if (row.needed != null) return `${row.needed} needed ${row.neededForRunoff ? 'for a run-off' : 'to make the final'} (normal finishes)`;
  if (row.racesLeft > 0) return `${row.racesLeft} ${row.racesLeft === 1 ? 'race' : 'races'} left`;
  return null;
}
