import { api } from '../api';
import { savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../offline/savedCopies';
import type { CompetitionDetail } from '../types';

/**
 * Warms the `GET /api/competitions/:id` response and local `savedCopies` store
 * on pointer-down / mouse-enter so navigating into a competition is instantaneous.
 */
export function prefetchCompetition(competitionId: number): Promise<void> {
  return api
    .get<CompetitionDetail>(`/competitions/${competitionId}`)
    .then(({ data, headers }) => {
      if (
        serviceWorkerSavedAt(headers) === null &&
        data &&
        typeof data === 'object' &&
        Array.isArray(data.sessions)
      ) {
        writeSavedCopy(savedCopyKeys.competition(competitionId), data);
      }
    })
    .catch(() => {
      // Best-effort warm-up; navigation handles any real error.
    });
}

/**
 * Creates a deduplicated competition prefetcher that triggers `prefetch` at most once per competition ID.
 */
export function createCompetitionPrefetcher(
  prefetch: (competitionId: number) => unknown = prefetchCompetition,
): {
  warm: (competitionId: number) => void;
  hasWarmed: (competitionId: number) => boolean;
} {
  const warmed = new Set<number>();
  return {
    warm(competitionId: number) {
      if (warmed.has(competitionId)) return;
      warmed.add(competitionId);
      prefetch(competitionId);
    },
    hasWarmed(competitionId: number) {
      return warmed.has(competitionId);
    },
  };
}
