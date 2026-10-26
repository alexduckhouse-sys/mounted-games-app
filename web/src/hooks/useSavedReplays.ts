import { useEffect, useState } from 'react';
import { getSavedReplays, hydrateSavedReplays, subscribeSavedReplays, type SavedReplayClip } from '../live/replayBuffer';

/** The replay clips saved on this device for a competition, kept up to date as they are added, edited or removed. */
export function useSavedReplays(competitionId: number): SavedReplayClip[] {
  const [clips, setClips] = useState<SavedReplayClip[]>(() => getSavedReplays(competitionId));
  useEffect(() => {
    const update = () => setClips([...getSavedReplays(competitionId)]);
    const unsubscribe = subscribeSavedReplays(update);
    void hydrateSavedReplays(competitionId).then(update, () => {});
    return unsubscribe;
  }, [competitionId]);
  return clips;
}
