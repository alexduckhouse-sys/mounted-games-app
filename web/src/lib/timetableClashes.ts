// Unused in web UI yet — reserved for iOS / upcoming wiring
import type { CompetitionDetail, RiderEntry, Team } from '../types';
import { arenaNames, arenaToShow, heatName, nextHeats } from './following';
import { computeTimings, formatTime } from './time';
import { timetableRows, type TimetableStatus } from './timetableRows';

/** Maximum gap in minutes between two heats in different arenas to count as a timetable clash. */
export const CLASH_WINDOW_MINUTES = 15;

export interface NextUpRide {
  team: Team;
  heatId: number;
  sessionId: number;
  heatLabel: string;
  arenaName: string | null;
  lane: number;
  effectiveStart: Date | null;
  timeText: string;
  status: Exclude<TimetableStatus, 'finished'>;
  delayMinutes: number;
}

/**
 * Chronological "Next Up Across Your Teams" strip items when a user follows 2 or more teams.
 * Includes live delay-adjusted start time, Arena, Heat label, Lane, and Team (with Bib colour/description).
 */
export function nextUpAcrossTeams(
  competition: CompetitionDetail,
  followedTeamIds: ReadonlySet<number>,
): NextUpRide[] {
  const followedTeams = competition.teams.filter((t) => followedTeamIds.has(t.id));
  if (followedTeams.length < 2) return [];

  const arenas = arenaNames(competition.sessions);
  const nextByTeam = nextHeats(competition, followedTeamIds);
  const rides: NextUpRide[] = [];

  for (const team of followedTeams) {
    const entry = nextByTeam.get(team.id);
    if (entry?.kind !== 'heat' || !entry.row.heat || entry.row.status === 'finished') continue;
    const { row, lane } = entry;
    rides.push({
      team,
      heatId: row.heat!.id,
      sessionId: row.session.id,
      heatLabel: heatName(row),
      arenaName: arenaToShow(row.session, arenas) ?? (row.session.arenaName?.trim() || null),
      lane,
      effectiveStart: row.effective,
      timeText: formatTime(row.effective),
      status: row.status as Exclude<TimetableStatus, 'finished'>,
      delayMinutes: row.delayMinutes,
    });
  }

  return rides.sort(
    (a, b) =>
      (a.effectiveStart?.getTime() ?? Infinity) - (b.effectiveStart?.getTime() ?? Infinity) ||
      a.heatId - b.heatId ||
      a.lane - b.lane,
  );
}

export type TimetableClashReason = 'followed' | 'trainer' | 'pony';

export interface TimetableClashSide {
  team: Team;
  heatId: number;
  sessionId: number;
  heatLabel: string;
  arenaName: string;
  lane: number;
  effectiveStart: Date;
  timeText: string;
}

export interface TimetableClash {
  key: string;
  reason: TimetableClashReason;
  sharedDetail: string | null;
  gapMinutes: number;
  first: TimetableClashSide;
  second: TimetableClashSide;
  summary: string;
}

export interface TimetableDeclarationInput {
  teamId: number;
  riders: ReadonlyArray<Pick<RiderEntry, 'horseName' | 'ponyPassportNumber'>>;
}

export interface DetectTimetableClashesOptions {
  followedTeamIds?: ReadonlySet<number>;
  declarations?: ReadonlyArray<TimetableDeclarationInput>;
  windowMinutes?: number;
}

function normaliseToken(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function buildPonyMap(
  declarations: ReadonlyArray<TimetableDeclarationInput> | undefined,
): Map<number, Map<string, string>> {
  const byTeam = new Map<number, Map<string, string>>();
  if (!declarations) return byTeam;
  for (const form of declarations) {
    let tokens = byTeam.get(form.teamId);
    if (!tokens) {
      tokens = new Map<string, string>();
      byTeam.set(form.teamId, tokens);
    }
    for (const rider of form.riders) {
      const passport = normaliseToken(rider.ponyPassportNumber);
      const horse = normaliseToken(rider.horseName);
      if (passport) tokens.set(`passport:${passport}`, rider.horseName?.trim() || rider.ponyPassportNumber!.trim());
      if (horse) tokens.set(`horse:${horse}`, rider.horseName!.trim());
    }
  }
  return byTeam;
}

function sharedPonyLabel(
  teamAId: number,
  teamBId: number,
  poniesByTeam: Map<number, Map<string, string>>,
): string | null {
  const first = poniesByTeam.get(teamAId);
  const second = poniesByTeam.get(teamBId);
  if (!first || !second) return null;
  for (const [token, label] of first) {
    if (second.has(token)) return label;
  }
  return null;
}

/**
 * Finds timetable clashes where two followed teams, or two teams sharing the same
 * trainerUserId or declared ponyPassportNumber / horseName, have unfinished heats
 * scheduled within `windowMinutes` (default 15) of each other in different arenas.
 */
export function detectTimetableClashes(
  competition: CompetitionDetail,
  options: DetectTimetableClashesOptions = {},
): TimetableClash[] {
  const followedTeamIds = options.followedTeamIds ?? new Set<number>();
  const windowMinutes = options.windowMinutes ?? CLASH_WINDOW_MINUTES;
  const maxGapMs = Math.max(0, windowMinutes) * 60_000;
  const teamsById = new Map(competition.teams.map((t) => [t.id, t]));
  const poniesByTeam = buildPonyMap(options.declarations);

  const upcomingRows = timetableRows(competition.sessions, computeTimings(competition.sessions), true).filter(
    (row) => row.heat !== null && row.status !== 'finished' && row.effective !== null && Boolean(row.session.arenaName?.trim()),
  );

  interface CandidateSlot {
    team: Team;
    heatId: number;
    sessionId: number;
    heatLabel: string;
    arenaName: string;
    arenaKey: string;
    lane: number;
    effectiveStart: Date;
    timeText: string;
  }

  const slots: CandidateSlot[] = [];
  for (const row of upcomingRows) {
    const arenaName = row.session.arenaName!.trim();
    const arenaKey = arenaName.toLowerCase();
    const label = heatName(row);
    const effectiveStart = row.effective!;
    const timeText = formatTime(effectiveStart);
    for (const entry of row.heat!.entries) {
      const team = teamsById.get(entry.teamId);
      if (!team) continue;
      slots.push({
        team,
        heatId: row.heat!.id,
        sessionId: row.session.id,
        heatLabel: label,
        arenaName,
        arenaKey,
        lane: entry.laneIndex,
        effectiveStart,
        timeText,
      });
    }
  }

  const clashes: TimetableClash[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (a.team.id === b.team.id) continue;
      if (a.arenaKey === b.arenaKey) continue;

      const diffMs = Math.abs(a.effectiveStart.getTime() - b.effectiveStart.getTime());
      if (diffMs > maxGapMs) continue;

      const bothFollowed = followedTeamIds.has(a.team.id) && followedTeamIds.has(b.team.id);
      const sharedTrainer = Boolean(a.team.trainerUserId && a.team.trainerUserId === b.team.trainerUserId);
      const sharedPony = sharedPonyLabel(a.team.id, b.team.id, poniesByTeam);

      if (!bothFollowed && !sharedTrainer && !sharedPony) continue;

      const reason: TimetableClashReason = sharedPony ? 'pony' : sharedTrainer ? 'trainer' : 'followed';
      const sharedDetail = sharedPony ?? (sharedTrainer ? a.team.trainerName?.trim() || b.team.trainerName?.trim() || 'Shared trainer' : null);

      const [first, second] =
        a.effectiveStart.getTime() < b.effectiveStart.getTime() ||
        (a.effectiveStart.getTime() === b.effectiveStart.getTime() && a.team.id < b.team.id)
          ? [a, b]
          : [b, a];

      const minTeam = Math.min(first.team.id, second.team.id);
      const maxTeam = Math.max(first.team.id, second.team.id);
      const minHeat = Math.min(first.heatId, second.heatId);
      const maxHeat = Math.max(first.heatId, second.heatId);
      const key = `clash-${minTeam}-${maxTeam}-${minHeat}-${maxHeat}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const gapMinutes = Math.round(diffMs / 60_000);
      const gapWords = gapMinutes === 0 ? 'at the same time' : `${gapMinutes} min apart`;
      const summary = `${first.team.displayName} (${first.arenaName}, ${first.timeText}) and ${second.team.displayName} (${second.arenaName}, ${second.timeText}) are ${gapWords} in different arenas.`;

      clashes.push({
        key,
        reason,
        sharedDetail,
        gapMinutes,
        first: {
          team: first.team,
          heatId: first.heatId,
          sessionId: first.sessionId,
          heatLabel: first.heatLabel,
          arenaName: first.arenaName,
          lane: first.lane,
          effectiveStart: first.effectiveStart,
          timeText: first.timeText,
        },
        second: {
          team: second.team,
          heatId: second.heatId,
          sessionId: second.sessionId,
          heatLabel: second.heatLabel,
          arenaName: second.arenaName,
          lane: second.lane,
          effectiveStart: second.effectiveStart,
          timeText: second.timeText,
        },
        summary,
      });
    }
  }

  return clashes.sort(
    (a, b) =>
      a.first.effectiveStart.getTime() - b.first.effectiveStart.getTime() ||
      a.gapMinutes - b.gapMinutes ||
      a.first.team.id - b.first.team.id ||
      a.first.heatId - b.first.heatId,
  );
}
