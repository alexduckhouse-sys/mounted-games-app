import { useEffect, useState } from 'react';
import { FAVOURITES_CHANGED } from '../lib/favourites';
import { FOLLOWED_PROFILES_KEY, readFollowedProfiles, setFollowedProfile, toggleFollowedProfile, type FollowedProfile } from '../lib/followedProfiles';

/** The team profiles followed on this device. Stays in step across components and tabs. */
export function useFollowedProfiles() {
  const [profiles, setProfiles] = useState(readFollowedProfiles);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setProfiles(readFollowedProfiles());
    const storage = (event: StorageEvent) => { if (event.key === FOLLOWED_PROFILES_KEY || event.key === null) refresh(); };
    window.addEventListener(FAVOURITES_CHANGED, refresh);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(FAVOURITES_CHANGED, refresh);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return {
    profiles, error,
    isFollowed: (id: string) => profiles.some((item) => item.id === id),
    toggle: (profile: FollowedProfile) => setError(toggleFollowedProfile(profile)),
    set: (profile: FollowedProfile, follow: boolean) => setError(setFollowedProfile(profile, follow)),
  };
}
