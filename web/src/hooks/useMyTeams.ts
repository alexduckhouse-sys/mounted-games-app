import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import type { CompetitionDetail, DeclarationForm, Team } from '../types';

/**
 * The signed-in person's teams, each team's competition (for heat times) and the declaration forms they can see.
 * Nothing is fetched for a visitor. Each part keeps what it had if its request fails.
 */
export function useMyTeams() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // The lists remember whose they are, so one person's teams are never shown to the next.
  const [loaded, setLoaded] = useState<{ userId: string; teams: Team[]; forms: DeclarationForm[] } | null>(null);
  const [comps, setComps] = useState<{ key: string; byId: Map<number, CompetitionDetail> } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    Promise.all([
      api.get<Team[]>('/trainer/my-teams').then((r) => (Array.isArray(r.data) ? r.data : null)).catch(() => null),
      api.get<DeclarationForm[]>('/declaration-forms').then((r) => (Array.isArray(r.data) ? r.data : null)).catch(() => null),
    ]).then(([teams, forms]) => {
      if (cancelled) return;
      setLoaded((previous) => ({
        userId,
        teams: teams ?? (previous?.userId === userId ? previous.teams : []),
        forms: forms ?? (previous?.userId === userId ? previous.forms : []),
      }));
    });
    return () => { cancelled = true; };
  }, [userId, attempt]);

  const mine = loaded && loaded.userId === userId ? loaded : null;
  const teams = mine?.teams;
  const compKey = teams ? `${userId}:${[...new Set(teams.map((t) => t.competitionId))].sort().join(',')}` : '';

  useEffect(() => {
    if (!teams || !compKey) return;
    let cancelled = false;
    const ids = [...new Set(teams.map((t) => t.competitionId))];
    const next = new Map<number, CompetitionDetail>();
    Promise.all(ids.map((id) => api.get<CompetitionDetail>(`/competitions/${id}`).then((r) => { next.set(id, r.data); }).catch(() => {})))
      .then(() => { if (!cancelled) setComps({ key: compKey, byId: next }); });
    return () => { cancelled = true; };
    // The teams list changes identity on every reload; only the set of competitions matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compKey]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    /** False until the first answer for this person. */
    loaded: mine !== null,
    teams: mine?.teams ?? NO_TEAMS,
    forms: mine?.forms ?? NO_FORMS,
    comps: comps && comps.key === compKey ? comps.byId : NO_COMPS,
    reload,
  };
}

const NO_TEAMS: Team[] = [];
const NO_FORMS: DeclarationForm[] = [];
const NO_COMPS = new Map<number, CompetitionDetail>();
