import type {
  CommentatorBriefing,
  CommentatorLaneSquad,
  DeclarationForm,
  Heat,
  Race,
  RiderEntry,
  Session,
  StandingRow,
  Team,
} from '../types';
import { formatPoints } from './formatPoints';
import { parseBibAndFlag } from './bib';
import { publicRiderName } from './riderNames';

/** One team's line in the official standings, best first. */
export interface FactStanding {
  teamId: number;
  totalPoints: number;
  racesRun: number;
}

const RACE_NAME_ALIASES: Record<string, string> = {
  'litter lifter': 'Litter',
  'bottle shuttle': 'Bottle',
  'mug shuffle': 'Two Mug',
  'pole bending': 'Bending',
};

export function canonicalGameName(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return '';
  return RACE_NAME_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Formats a declared rider + pony for commentator notes while respecting `useInitialOnly`
 * and never exposing dates of birth, phone numbers, or medical notes.
 */
export function formatPrivacySafeRiderPony(rider: Pick<RiderEntry, 'fullName' | 'horseName' | 'useInitialOnly' | 'isCaptain' | 'isReserve'>): string {
  const safeName = publicRiderName(rider);
  const pony = rider.horseName?.trim() || null;
  const suffix = rider.isCaptain ? ' (Capt)' : rider.isReserve ? ' (Reserve)' : '';
  return pony ? `${safeName} on ${pony}${suffix}` : `${safeName}${suffix}`;
}

/** How many of the latest scored races in a row a team has won (0 when it won none, or the latest was not a win). */
export function winStreak(races: readonly Race[], teamId: number): number {
  const scored = races.filter((r) => r.isComplete).sort((a, b) => b.orderIndex - a.orderIndex);
  let streak = 0;
  for (const race of scored) {
    const result = race.results.find((r) => r.teamId === teamId);
    if (!result || result.eliminated || result.placing !== 1) break;
    streak += 1;
  }
  return streak;
}

/**
 * The one short line shown under a team while scoring: its streak in this heat and where it stands in the official
 * standings. Nothing is said about standing until a race has been run.
 */
export function commentatorFacts(
  teamIds: readonly number[],
  races: readonly Race[],
  standings: readonly FactStanding[],
): Record<number, string> {
  const started = standings.some((s) => s.racesRun > 0);
  const leader = standings[0]?.totalPoints ?? 0;
  const out: Record<number, string> = {};
  for (const teamId of teamIds) {
    const streak = winStreak(races, teamId);
    const row = standings.findIndex((s) => s.teamId === teamId);
    const parts: string[] = [];
    if (streak >= 2) parts.push(`Won the last ${streak} races`);
    else if (streak === 1) parts.push('Won the last race');
    if (started && row === 0) parts.push('Leading');
    else if (started && row > 0) {
      const gap = leader - standings[row].totalPoints;
      if (gap > 0) parts.push(`${formatPoints(gap)} ${gap === 1 ? 'point' : 'points'} behind 1st`);
    }
    if (parts.length > 0) out[teamId] = parts.join(' · ');
  }
  return out;
}

export function computeBiggestStandingsMover(
  sessions: readonly Session[],
  teams: readonly Team[],
  currentStandings: readonly StandingRow[],
): string | null {
  const scoredSessions = [...sessions]
    .filter((s) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0 && s.heats.some((h) => h.races.some((r) => r.isComplete)))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
  if (scoredSessions.length < 2) return null;

  const priorRaces = scoredSessions
    .slice(0, -1)
    .flatMap((s) => s.heats)
    .flatMap((h) => h.races)
    .filter((r) => r.isComplete);
  if (priorRaces.length === 0) return null;

  const latestSession = scoredSessions[scoredSessions.length - 1];
  const latestRaces = latestSession.heats.flatMap((h) => h.races).filter((r) => r.isComplete);

  const activeTeams = teams.filter((t) => !t.isHorsConcours && !t.isWithdrawn);
  const priorOrder = activeTeams
    .map((t) => {
      const results = priorRaces.flatMap((r) => r.results).filter((res) => res.teamId === t.id);
      const pts = results.reduce((sum, res) => sum + res.points, 0);
      const wins = results.filter((res) => !res.eliminated && res.placing === 1).length;
      return { team: t, pts, wins };
    })
    .sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.team.displayName.localeCompare(b.team.displayName));

  const currentRankMap = new Map<number, number>();
  currentStandings.forEach((row, idx) => currentRankMap.set(row.teamId, idx + 1));

  let bestClimb = 0;
  let bestTeam: Team | null = null;
  let latestGain = 0;

  priorOrder.forEach((item, idx) => {
    const prevRank = idx + 1;
    const nowRank = currentRankMap.get(item.team.id);
    if (!nowRank) return;
    const climb = prevRank - nowRank;
    if (climb > bestClimb) {
      bestClimb = climb;
      bestTeam = item.team;
      latestGain = latestRaces
        .flatMap((r) => r.results)
        .filter((res) => res.teamId === item.team.id)
        .reduce((sum, res) => sum + res.points, 0);
    }
  });

  if (!bestTeam || bestClimb < 1) return null;
  const chosen: Team = bestTeam;
  const nowRank = currentRankMap.get(chosen.id) ?? 1;
  return `Biggest mover: ${chosen.displayName} climbed ${bestClimb} ${bestClimb === 1 ? 'place' : 'places'} to #${nowRank} (+${formatPoints(latestGain)} pts in ${latestSession.name}).`;
}

export function buildCommentatorBriefing(params: {
  competitionId: number;
  session: Session;
  heat: Heat;
  standings: readonly StandingRow[];
  teams: readonly Team[];
  allSessions?: readonly Session[];
  declarations?: readonly DeclarationForm[];
  finalistCount?: number | null;
}): CommentatorBriefing {
  const { competitionId, session, heat, standings, teams, allSessions = [session], declarations = [], finalistCount } = params;
  const teamsById = new Map<number, Team>(teams.map((t) => [t.id, t]));
  const standingsByTeam = new Map<number, { row: StandingRow; rank: number }>();
  standings.forEach((row, idx) => standingsByTeam.set(row.teamId, { row, rank: idx + 1 }));

  const latestDeclByTeam = new Map<number, DeclarationForm>();
  for (const d of declarations) {
    const prev = latestDeclByTeam.get(d.teamId);
    if (!prev || d.submittedAt > prev.submittedAt) {
      latestDeclByTeam.set(d.teamId, d);
    }
  }

  const orderedHeatRaces = heat.races.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const currentRace = orderedHeatRaces.find((r) => !r.isComplete) ?? orderedHeatRaces[orderedHeatRaces.length - 1] ?? null;
  const canonicalCurrent = currentRace ? canonicalGameName(currentRace.name) : '';

  const allCompletedRaces = allSessions
    .flatMap((s) => s.heats)
    .flatMap((h) => h.races)
    .filter((r) => r.isComplete);

  const cutline = Math.max(2, finalistCount ?? session.lanesPerHeat ?? 5);
  const cutlinePoints = standings.length >= cutline ? standings[cutline - 1].totalPoints : 0;
  const firstOutsidePoints = standings.length > cutline ? standings[cutline].totalPoints : 0;
  const hasScored = standings.some((s) => s.racesRun > 0);

  const biggestMoverHeadline = computeBiggestStandingsMover(allSessions, teams, standings);
  const talkingPoints: string[] = [];
  if (biggestMoverHeadline) talkingPoints.push(biggestMoverHeadline);

  const lanes: CommentatorLaneSquad[] = heat.entries
    .slice()
    .sort((a, b) => a.laneIndex - b.laneIndex)
    .map((entry) => {
      const team = teamsById.get(entry.teamId);
      const standing = standingsByTeam.get(entry.teamId);
      const rank = standing?.rank ?? null;
      const totalPoints = standing?.row.totalPoints ?? 0;

      const decl = latestDeclByTeam.get(entry.teamId);
      const ridersAndPonies = decl
        ? decl.riders
            .slice()
            .sort((a, b) => Number(a.isReserve) - Number(b.isReserve) || a.orderIndex - b.orderIndex)
            .map((r) => formatPrivacySafeRiderPony(r))
        : [];

      let stakesHeadline: string | null = null;
      if (hasScored && rank !== null) {
        if (rank === 1) {
          const margin = standings.length > 1 ? totalPoints - standings[1].totalPoints : 0;
          stakesHeadline =
            margin > 0
              ? `Leading overall on ${formatPoints(totalPoints)} pts (+${formatPoints(margin)} clear of 2nd)`
              : `Joint leader on ${formatPoints(totalPoints)} pts`;
        } else if (standings.length > cutline && rank <= cutline) {
          const cushion = totalPoints - firstOutsidePoints;
          stakesHeadline = `#${rank} overall (${formatPoints(totalPoints)} pts), ${formatPoints(cushion)} pts clear of the A final cut-off`;
        } else if (standings.length > cutline && rank > cutline) {
          const deficit = cutlinePoints - totalPoints;
          stakesHeadline =
            deficit <= 10
              ? `#${rank} overall (${formatPoints(totalPoints)} pts), ${formatPoints(deficit)} pts off the A final cut-off`
              : `#${rank} overall (${formatPoints(totalPoints)} pts)`;
        } else {
          stakesHeadline = `#${rank} overall (${formatPoints(totalPoints)} pts)`;
        }
      }

      const specialistParts: string[] = [];
      if (canonicalCurrent) {
        const sameGame = allCompletedRaces.filter(
          (r) => canonicalGameName(r.name).toLowerCase() === canonicalCurrent.toLowerCase(),
        );
        let runs = 0;
        let wins = 0;
        for (const r of sameGame) {
          const res = r.results.find((x) => x.teamId === entry.teamId && !x.isSitOut);
          if (!res) continue;
          runs += 1;
          if (!res.eliminated && res.placing === 1) wins += 1;
        }
        if (wins >= 2) specialistParts.push(`Won ${wins} of ${runs} in ${canonicalCurrent}`);
        else if (wins === 1 && runs === 1) specialistParts.push(`Won their previous ${canonicalCurrent} run`);
      }

      const streak = winStreak(orderedHeatRaces, entry.teamId);
      if (streak >= 2) specialistParts.push(`On a ${streak}-race win streak in this heat`);
      else if (streak === 1 && specialistParts.length === 0) specialistParts.push('Won the last race in this heat');

      const gameSpecialistNote = specialistParts.length > 0 ? specialistParts.join(' · ') : null;

      if (stakesHeadline && (rank === 1 || rank === cutline || rank === cutline + 1)) {
        talkingPoints.push(`Lane ${entry.laneIndex} (${entry.teamName}): ${stakesHeadline}.`);
      }
      if (gameSpecialistNote) {
        talkingPoints.push(`Lane ${entry.laneIndex} (${entry.teamName}): ${gameSpecialistNote}.`);
      }

      const rawBib = entry.bibColourOverride || entry.bibColour || team?.bibColour || null;
      const parsedBib = parseBibAndFlag(rawBib);
      return {
        laneIndex: entry.laneIndex,
        teamId: entry.teamId,
        teamName: entry.teamName,
        clubName: team?.clubName ?? '',
        bibColour: parsedBib.bib || null,
        bibDescription: entry.bibDescription ?? team?.bibDescription ?? null,
        flag: entry.flag ?? parsedBib.flag ?? null,
        currentRank: rank,
        totalPoints,
        ridersAndPonies,
        stakesHeadline,
        gameSpecialistNote,
      };
    });

  return {
    competitionId,
    sessionId: session.id,
    sessionName: session.name,
    heatId: heat.id,
    heatLabel: heat.label?.trim() || `Heat ${heat.orderIndex}`,
    currentRaceId: currentRace?.id ?? null,
    currentRaceName: currentRace?.name ?? null,
    talkingPoints: talkingPoints.slice(0, 6),
    biggestMoverHeadline,
    lanes,
  };
}
