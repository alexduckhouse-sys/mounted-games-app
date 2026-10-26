import { useCallback, useRef } from 'react';
import { prefetchCompetition } from '../lib/competitionPrefetch';

/**
 * Returns `onPointerDown` and `onMouseEnter` handlers that warm `/api/competitions/:id`
 * at most once per mounted component for each competition ID.
 */
export function useCompetitionPrefetch(
  prefetch: (competitionId: number) => unknown = prefetchCompetition,
) {
  const warmedRef = useRef<Set<number>>(new Set());

  const warm = useCallback(
    (competitionId: number) => {
      if (warmedRef.current.has(competitionId)) return;
      warmedRef.current.add(competitionId);
      prefetch(competitionId);
    },
    [prefetch],
  );

  const handlersFor = useCallback(
    (competitionId: number) => ({
      onPointerDown: () => warm(competitionId),
      onMouseEnter: () => warm(competitionId),
    }),
    [warm],
  );

  return { warm, handlersFor };
}
