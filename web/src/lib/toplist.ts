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
  /** Withdrawn or no-show: what they scored stays, they ride no more. */
  withdrawn: boolean;
  /** Tack check bonus points, already in `points`. */
  bonus: number;
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
    return { teamId: row.teamId, teamName: row.teamName, points: row.totalPoints, position, joint, runoff: false, out: false, needed: null, racesLeft: racesLeft.get(row.teamId) ?? 0, withdrawn: row.withdrawn === true, bonus: row.bonusPoints ?? 0 };
  });

  const hcTeams = teams.filter((team) => team.isHorsConcours && team.competitionSectionId === sectionId);
  const hcTeamIds = new Set(hcTeams.map((team) => team.id));

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
 * On-device finals qualification calculator.
 * Uses exact Mounted Games heat slot conservation (`[B, B-1, ..., B-m+1]` per race) and optimal
 * rival slot matching across all remaining unscored races so teams below the cut-off see the true
 * minimum points needed to make the final (or `null` once mathematically eliminated).
 */
function assignPointsNeeded(
  rows: ToplistRow[],
  cutAfter: number,
  places: number,
  linePoints: number,
  heatSessions: Session[],
  hcTeamIds: Set<number>,
) {
  const withdrawnIds = new Set(rows.filter((r) => r.withdrawn).map((r) => r.teamId));

  const baseBySession = new Map<number, number>();
  for (const session of heatSessions) {
    const nonFinalHeats = session.heats.filter((h) => !isFinal(session, h));
    const maxEntries = Math.max(
      0,
      ...nonFinalHeats.map((h) => {
        const activeCount = h.entries.filter((e) => !hcTeamIds.has(e.teamId)).length;
        return session.lanesPerHeat && session.lanesPerHeat > 0 ? Math.min(activeCount, session.lanesPerHeat) : activeCount;
      }),
    );
    const maxScored = Math.max(
      0,
      ...nonFinalHeats.flatMap((h) => h.races.flatMap((r) => r.results.map((res) => res.points))),
    );
    const fallback = session.lanesPerHeat && session.lanesPerHeat > 0 ? Math.min(rows.length, session.lanesPerHeat) : rows.length;
    baseBySession.set(session.id, maxEntries <= 1 && maxScored === 0 ? Math.max(maxEntries, fallback, 1) : Math.max(maxEntries, maxScored, 1));
  }

  interface OpenRace {
    raceMax: number;
    stage: number | null | undefined;
    activeTeamIds: number[];
  }

  const openRaces: OpenRace[] = [];
  const maxGainByTeam = new Map<number, number>();

  for (const session of heatSessions) {
    const base = baseBySession.get(session.id) ?? Math.max(1, rows.length);
    for (const heat of session.heats) {
      if (isFinal(session, heat) || heatDone(heat)) continue;
      const raceMax = heat.raceRoundStage === 1 ? 1 : base;
      const entrants = heat.entries
        .map((e) => e.teamId)
        .filter((id) => !hcTeamIds.has(id) && !withdrawnIds.has(id));
      if (entrants.length === 0) continue;

      for (const race of heat.races) {
        if (race.isComplete) continue;
        const activeTeamIds = entrants.filter(
          (id) => !race.results.some((res) => res.teamId === id && res.isSitOut),
        );
        if (activeTeamIds.length === 0) continue;
        openRaces.push({ raceMax, stage: heat.raceRoundStage, activeTeamIds });
        for (const teamId of activeTeamIds) {
          maxGainByTeam.set(teamId, (maxGainByTeam.get(teamId) ?? 0) + raceMax);
        }
      }
    }
  }

  /**
   * Simulates the remaining open races when `candidateId` scores a total of `candidateGain`
   * across its remaining races, assigning the remaining finishing slots in each race to rival
   * teams so that as few rivals as possible reach `targetTotal = candidate.points + candidateGain`.
   * Returns the `places`-th highest rival score under that best-case slot assignment.
   */
  function minPossibleCutOff(candidateId: number, candidateGain: number, targetTotal: number): number {
    const pts = new Map<number, number>(rows.map((r) => [r.teamId, r.points]));

    const candidateRaceIndices: number[] = [];
    let totalMax = 0;
    openRaces.forEach((r, idx) => {
      if (r.activeTeamIds.includes(candidateId)) {
        candidateRaceIndices.push(idx);
        totalMax += r.raceMax;
      }
    });

    const candidateRacePts = new Map<number, number>();
    if (candidateRaceIndices.length > 0 && totalMax > 0) {
      let allocated = 0;
      for (const idx of candidateRaceIndices) {
        const m = openRaces[idx].raceMax;
        const share = Math.min(m, Math.floor((candidateGain * m) / totalMax));
        candidateRacePts.set(idx, share);
        allocated += share;
      }
      let rem = candidateGain - allocated;
      for (const idx of candidateRaceIndices) {
        if (rem <= 0) break;
        const cur = candidateRacePts.get(idx) ?? 0;
        const m = openRaces[idx].raceMax;
        if (cur < m) {
          candidateRacePts.set(idx, cur + 1);
          rem--;
        }
      }
    }

    openRaces.forEach((race, idx) => {
      const active = race.activeTeamIds;
      const slots = race.stage === 1
        ? active.map(() => 1)
        : active.map((_, laneIdx) => Math.max(0, race.raceMax - laneIdx));

      const remainingSlots = [...slots];
      const others = active.filter((id) => id !== candidateId);
      if (others.length < active.length) {
        const cPts = candidateRacePts.get(idx) ?? 0;
        let bestIdx = 0;
        let bestDiff = Infinity;
        remainingSlots.forEach((slotPts, sIdx) => {
          const diff = Math.abs(slotPts - cPts);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = sIdx;
          }
        });
        remainingSlots.splice(bestIdx, 1);
      }

      if (others.length === 0) return;

      // Sort rivals by current points descending so the closest threats to `targetTotal` are handled first.
      others.sort((a, b) => (pts.get(b) ?? 0) - (pts.get(a) ?? 0) || a - b);
      // Keep `remainingSlots` sorted descending.
      remainingSlots.sort((a, b) => b - a);

      for (const rivalId of others) {
        const cur = pts.get(rivalId) ?? 0;
        // Find the largest slot `w` that still keeps `cur + w < targetTotal`.
        let chosenSlotIdx = -1;
        for (let sIdx = 0; sIdx < remainingSlots.length; sIdx++) {
          if (cur + remainingSlots[sIdx] < targetTotal) {
            chosenSlotIdx = sIdx;
            break;
          }
        }
        // If no slot can keep the rival below `targetTotal`, let them absorb the largest available slot.
        if (chosenSlotIdx === -1) chosenSlotIdx = 0;
        const [awarded] = remainingSlots.splice(chosenSlotIdx, 1);
        pts.set(rivalId, cur + (awarded ?? 0));
      }
    });

    const otherTotals = rows
      .filter((r) => r.teamId !== candidateId)
      .map((r) => pts.get(r.teamId) ?? r.points)
      .sort((a, b) => b - a);
    return otherTotals[places - 1] ?? linePoints;
  }

  rows.forEach((row, index) => {
    if (index <= cutAfter) return;
    row.out = true;
    if (row.racesLeft <= 0 || row.withdrawn) return;

    const maxGain = maxGainByTeam.get(row.teamId) ?? 0;
    if (row.points + maxGain < linePoints) {
      row.needed = null;
      return;
    }

    const minToPass = Math.max(1, Math.floor(linePoints - row.points) + 1);
    let chosen: number | null = null;
    for (let x = minToPass; x <= maxGain; x++) {
      const candidateTotal = row.points + x;
      const cutOff = Math.max(linePoints, minPossibleCutOff(row.teamId, x, candidateTotal));
      if (candidateTotal > cutOff) {
        chosen = x;
        break;
      }
    }

    if (chosen != null) {
      row.needed = chosen;
      return;
    }

    // Check if winning every remaining race (`maxGain`) at least ties the cut-off for a run-off.
    const maxTotal = row.points + maxGain;
    const cutOffAtMax = Math.max(linePoints, minPossibleCutOff(row.teamId, maxGain, maxTotal + 1));
    row.needed = maxTotal >= cutOffAtMax ? maxGain : null;
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
          races.set(result.teamId, [...(races.get(result.teamId) ?? []), { id: result.id, name: race.name, placing: result.placing, eliminated: result.eliminated, points: result.points, status: result.status }]);
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
        race.results.filter((result) => result.teamId === teamId).map((result) => ({ id: result.id, name: race.name, placing: result.placing, eliminated: result.eliminated, points: result.points, status: result.status })));
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
  const tack = row.bonus > 0 ? `${row.bonus} tack bonus ${row.bonus === 1 ? 'point' : 'points'}` : null;
  return [standingNote(row), tack].filter(Boolean).join(' · ') || null;
}

function standingNote(row: ToplistRow): string | null {
  if (row.withdrawn) return 'Withdrawn';
  if (row.runoff) return `Joint ${ordinal(row.position)} · run-off`;
  if (row.needed != null) return `${row.needed} needed to make the final`;
  if (row.racesLeft > 0) return `${row.racesLeft} ${row.racesLeft === 1 ? 'race' : 'races'} left`;
  return null;
}
