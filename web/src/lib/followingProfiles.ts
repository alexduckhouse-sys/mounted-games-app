import { isOnToday } from './competitionDates';

/** What the site Following page works out about a followed team profile, from public data only. */
export interface ProfileEventTeam { competitionId: number; competitionName: string; teamId: number }
export interface ProfileResult { competitionName: string; competitionDate: string; eventRank: number; publicationVersion?: number }
export interface CompetitionDates { id: number; startDate: string; endDate?: string | null; isArchived?: boolean }
export interface ProfileClub { id: string; clubId: number; clubName: string; displayName: string }

export interface UpcomingEntry extends ProfileEventTeam { startDate: string; endDate: string | null }

/** The soonest competition that has not finished and has an event team linked to the profile. */
export function nextEntry(eventTeams: ProfileEventTeam[], competitions: CompetitionDates[], now: Date): UpcomingEntry | null {
  let best: UpcomingEntry | null = null;
  for (const link of eventTeams) {
    const competition = competitions.find((item) => item.id === link.competitionId);
    if (!competition || competition.isArchived) continue;
    const start = new Date(competition.startDate).getTime();
    if (Number.isNaN(start)) continue;
    const upcoming = isOnToday(competition.startDate, competition.endDate, now) || start > now.getTime();
    if (!upcoming) continue;
    if (!best || start < new Date(best.startDate).getTime()) best = { ...link, startDate: competition.startDate, endDate: competition.endDate ?? null };
  }
  return best;
}

/** The latest published result, where a newer version of the same round does not count twice. */
export function lastOut(results: ProfileResult[]): { place: number; competitionName: string; date: string } | null {
  let best: ProfileResult | null = null;
  for (const result of results) {
    const when = new Date(result.competitionDate).getTime();
    if (Number.isNaN(when)) continue;
    const bestWhen = best ? new Date(best.competitionDate).getTime() : -Infinity;
    if (when > bestWhen || (when === bestWhen && (result.publicationVersion ?? 0) > (best?.publicationVersion ?? 0))) best = result;
  }
  return best ? { place: best.eventRank, competitionName: best.competitionName, date: best.competitionDate } : null;
}

/** For a club-wide profile (named like its club) the number of teams the club has; otherwise there is nothing to say. */
export function clubTeamCount(profileId: string, all: ProfileClub[]): number | null {
  const profile = all.find((item) => item.id === profileId);
  if (!profile || profile.displayName.trim().toLowerCase() !== profile.clubName.trim().toLowerCase()) return null;
  const count = all.filter((item) => item.clubId === profile.clubId).length;
  return count > 1 ? count : null;
}
