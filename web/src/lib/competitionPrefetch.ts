import { api } from '../api';
import { savedCopyKeys, serviceWorkerSavedAt, writeSavedCopy } from '../offline/savedCopies';
import type { CompetitionDetail } from '../types';
import type { AxiosResponse } from 'axios';

type Pending = { identity: string | null; response: Promise<AxiosResponse<CompetitionDetail>> };
const pending = new Map<number, Pending>();

// An opaque identity prevents a request from one sign-in being adopted by another.
function identity(): string | null {
  try { return localStorage.getItem('mg.auth'); } catch { return null; }
}

/** Adopt only an identical, still-running detail fetch. First-view remains a separate request. */
export function pendingCompetitionPrefetch(competitionId: number): Promise<AxiosResponse<CompetitionDetail>> | undefined {
  const request = pending.get(competitionId);
  return request?.identity === identity() ? request?.response : undefined;
}

/** Warm public saved data and let immediate navigation share the same in-flight request. */
export function prefetchCompetition(competitionId: number): Promise<void> {
  const existing = pendingCompetitionPrefetch(competitionId);
  if (existing) return existing.then(() => {}, () => {});
  const startedAs = identity();
  const response = api.get<CompetitionDetail>(`/competitions/${competitionId}`).then((result) => {
    if (identity() !== startedAs) throw new Error('Sign-in changed while loading the competition.');
    const { data, headers } = result;
    if (serviceWorkerSavedAt(headers) === null && data && typeof data === 'object' && Array.isArray(data.sessions)) {
      writeSavedCopy(savedCopyKeys.competition(competitionId), data);
    }
    return result;
  });
  const request = { identity: startedAs, response };
  pending.set(competitionId, request);
  return response.then(() => {}, () => {}).finally(() => {
    if (pending.get(competitionId) === request) pending.delete(competitionId);
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
