import { FAVOURITES_CHANGED } from './favourites';

/**
 * Team profiles followed on this device, so a team or club team can be followed from its profile page
 * without being inside a competition. Public data only (an id and two names); following grants nothing.
 */
export interface FollowedProfile { id: string; name: string; clubName: string }
export const FOLLOWED_PROFILES_KEY = 'mg.following.profiles.v1';
export const MAX_FOLLOWED_PROFILES = 100;

function valid(value: unknown): value is FollowedProfile {
  if (!value || typeof value !== 'object') return false;
  const item = value as FollowedProfile;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
    && typeof item.name === 'string' && typeof item.clubName === 'string';
}

export function readFollowedProfiles(): FollowedProfile[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FOLLOWED_PROFILES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, FollowedProfile>();
    for (const item of parsed) {
      if (valid(item)) unique.set(item.id, { id: item.id, name: item.name.slice(0, 200), clubName: item.clubName.slice(0, 200) });
    }
    return [...unique.values()].slice(0, MAX_FOLLOWED_PROFILES);
  } catch { return []; }
}

/** Follows or unfollows one team profile. Returns a message to show when it couldn't be done, or null. */
export function setFollowedProfile(profile: FollowedProfile, follow: boolean): string | null {
  if (!valid(profile)) return 'This team couldn’t be followed. Refresh the page and try again.';
  const current = readFollowedProfiles();
  const exists = current.some((item) => item.id === profile.id);
  if (exists === follow) return null;
  if (follow && current.length >= MAX_FOLLOWED_PROFILES) return `You’re following ${MAX_FOLLOWED_PROFILES} teams. Remove a team before adding another.`;
  const next = follow ? [...current, { id: profile.id, name: profile.name, clubName: profile.clubName }] : current.filter((item) => item.id !== profile.id);
  try {
    if (next.length) localStorage.setItem(FOLLOWED_PROFILES_KEY, JSON.stringify(next));
    else localStorage.removeItem(FOLLOWED_PROFILES_KEY);
  } catch { return 'Your choice couldn’t be saved on this device. Check your browser’s storage settings and try again.'; }
  window.dispatchEvent(new Event(FAVOURITES_CHANGED));
  return null;
}

export function toggleFollowedProfile(profile: FollowedProfile): string | null {
  return setFollowedProfile(profile, !readFollowedProfiles().some((item) => item.id === profile.id));
}
