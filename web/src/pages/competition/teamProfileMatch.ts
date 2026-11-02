import type { TeamProfile } from '../seasons/teamProfileTypes';

/**
 * The club team profile that best fits an event team: same club, preferring the same name or suffix, else the club's
 * first profile. Null when the club has no profile (or the team has no club).
 */
export function matchTeamProfile(
  profiles: TeamProfile[],
  team: { clubId: number | null; displayName: string; suffix: string },
): TeamProfile | null {
  if (team.clubId == null) return null;
  const name = team.displayName.toLowerCase();
  const suffix = team.suffix.toLowerCase();
  return profiles.find((p) => p.clubId === team.clubId && (p.displayName.toLowerCase() === name || (!!p.suffix && p.suffix.toLowerCase() === suffix)))
    ?? profiles.find((p) => p.clubId === team.clubId)
    ?? null;
}
