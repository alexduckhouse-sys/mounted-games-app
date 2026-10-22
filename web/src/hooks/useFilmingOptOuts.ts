import { useEffect, useState } from 'react';
import { api } from '../api';
import type { FilmingOptOut } from '../types';

/**
 * Riders in this event's heats who asked not to be filmed close up. Staff only: the server refuses everyone
 * else, so any failure just means an empty list. Reloads when `refreshKey` changes (e.g. the timetable moved).
 */
export function useFilmingOptOuts(competitionId: number, refreshKey: unknown = 0): FilmingOptOut[] {
  const [optOuts, setOptOuts] = useState<FilmingOptOut[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    api.get<FilmingOptOut[]>(`/competitions/${competitionId}/filming-optouts`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setOptOuts(Array.isArray(data) ? data : []); })
      .catch(() => { if (!controller.signal.aborted) setOptOuts([]); });
    return () => controller.abort();
  }, [competitionId, refreshKey]);
  return optOuts;
}
