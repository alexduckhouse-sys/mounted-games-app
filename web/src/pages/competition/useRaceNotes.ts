import { useEffect, useState } from 'react';
import { api } from '../../api';

/** What staff-only `GET /api/races/:id/score` returns for each team (the rest of the shape isn't needed here). */
interface ScoreRow { teamId: number; refereeNote?: string | null }

/**
 * The private referee notes saved for a race, by team. Public results never carry them, so staff read them
 * from the staff-only score read. `version` changes when the race's results do, so a re-score is re-read.
 * Empty until read, when `enabled` is false, or if the read fails (a note is a convenience, not required).
 */
export function useRaceNotes(raceId: number | null, enabled: boolean, version: string): Record<number, string> {
  const [loaded, setLoaded] = useState<{ key: string; notes: Record<number, string> } | null>(null);
  const key = `${raceId}:${version}`;
  useEffect(() => {
    if (!enabled || raceId == null) return;
    let cancelled = false;
    api.get<{ results?: ScoreRow[] }>(`/races/${raceId}/score`)
      .then((response) => {
        if (cancelled) return;
        const notes: Record<number, string> = {};
        for (const row of response.data.results ?? []) if (row.refereeNote) notes[row.teamId] = row.refereeNote;
        setLoaded({ key, notes });
      })
      .catch(() => { if (!cancelled) setLoaded({ key, notes: {} }); });
    return () => { cancelled = true; };
  }, [raceId, enabled, key]);
  return enabled && loaded?.key === key ? loaded.notes : NO_NOTES;
}

const NO_NOTES: Record<number, string> = {};
