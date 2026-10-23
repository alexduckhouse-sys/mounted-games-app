import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { apiErrorMessage } from '../../lib/apiError';
import { useAuth } from '../../auth/AuthContext';
import type { Team, TrainerRequest } from '../../types';
import { NeedsYouContext, type NeedsYouValue } from './needsYou';

const NONE: TrainerRequest[] = [];
const NO_TEAMS: Team[] = [];

/**
 * What is waiting on the signed-in person, shared by the Me tab's badge and the profile page:
 * join requests for a club's team manager (their club's trainers) and for an admin (also team managers),
 * and the dec forms still to fill in for teams they look after.
 */
export function NeedsYouProvider({ children }: { children: ReactNode }) {
  const { user, hasRole } = useAuth();
  const userId = user?.id ?? null;
  const approves = hasRole('Admin') || hasRole('Manager');
  // Remember whose lists these are, so one person's are never shown to the next.
  const [loaded, setLoaded] = useState<{ userId: string; requests: TrainerRequest[] } | null>(null);
  const [teamsLoaded, setTeamsLoaded] = useState<{ userId: string; teams: Team[] } | null>(null);

  useEffect(() => {
    if (!approves || !userId) return;
    let cancelled = false;
    api.get<TrainerRequest[]>('/admin/trainer-requests').then(({ data }) => {
      if (!cancelled && Array.isArray(data)) setLoaded({ userId, requests: data });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [approves, userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.get<Team[]>('/trainer/my-teams').then(({ data }) => {
      if (!cancelled && Array.isArray(data)) setTeamsLoaded({ userId, teams: data });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const requests = approves && loaded && loaded.userId === userId ? loaded.requests : NONE;
  const teams = teamsLoaded && teamsLoaded.userId === userId ? teamsLoaded.teams : null;
  const decForms = useMemo(() => (teams ?? NO_TEAMS).filter((t) => t.needsDeclaration === true), [teams]);

  const [reviewError, setReviewError] = useState<string | null>(null);
  const review = useCallback(async (request: TrainerRequest, action: 'approve' | 'decline') => {
    setReviewError(null);
    try {
      await api.post(`/admin/trainer-requests/${encodeURIComponent(request.userId)}/${action}`);
    } catch (err) {
      setReviewError(apiErrorMessage(err, `Could not ${action} this request. Check your connection and try again.`));
      return false;
    }
    setLoaded((cur) => (cur ? { ...cur, requests: cur.requests.filter((r) => r.userId !== request.userId) } : cur));
    return true;
  }, []);

  const value = useMemo<NeedsYouValue>(
    () => ({ requests, teams, decForms, count: requests.length + decForms.length, review, reviewError }),
    [requests, teams, decForms, review, reviewError],
  );
  return <NeedsYouContext.Provider value={value}>{children}</NeedsYouContext.Provider>;
}
