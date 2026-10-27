// Unused in web UI yet — reserved for iOS / upcoming wiring
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { RiderRaceRole, TeamRaceLineupPlan } from '../types';

const storageKey = (competitionId: number, teamId: number) =>
  `mg:team-race-lineup:${competitionId}:${teamId}`;

function readLocalPlan(competitionId: number, teamId: number): Record<string, Record<string, RiderRaceRole | string>> {
  try {
    const raw = localStorage.getItem(storageKey(competitionId, teamId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, Record<string, RiderRaceRole | string>>)
      : {};
  } catch {
    return {};
  }
}

function writeLocalPlan(
  competitionId: number,
  teamId: number,
  assignments: Record<string, Record<string, RiderRaceRole | string>>,
): void {
  try {
    localStorage.setItem(storageKey(competitionId, teamId), JSON.stringify(assignments));
  } catch {
    // Ignore storage quota errors
  }
}

export interface UseTeamRaceLineupReturn {
  assignments: Record<string, Record<string, RiderRaceRole | string>>;
  updatedAt: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saveAssignments: (
    next: Record<string, Record<string, RiderRaceRole | string>>,
  ) => Promise<Record<string, Record<string, RiderRaceRole | string>>>;
  setRaceRow: (
    raceKey: string,
    row: Record<string, RiderRaceRole | string>,
  ) => Promise<Record<string, Record<string, RiderRaceRole | string>>>;
}

/**
 * Loads and syncs a team's 5-rider per-race lineup & sit-out plan via
 * `GET/PUT /competitions/:id/teams/:teamId/race-lineup` with `localStorage` fallback.
 */
const EMPTY_ASSIGNMENTS: Record<string, Record<string, RiderRaceRole | string>> = {};

export function useTeamRaceLineup(
  competitionId: number | null | undefined,
  teamId: number | null | undefined,
): UseTeamRaceLineupReturn {
  const targetKey = competitionId && teamId ? `${competitionId}:${teamId}` : null;
  const [state, setState] = useState<{
    key: string | null;
    assignments: Record<string, Record<string, RiderRaceRole | string>>;
    updatedAt: string | null;
    loaded: boolean;
  }>(() => ({
    key: targetKey,
    assignments: competitionId && teamId ? readLocalPlan(competitionId, teamId) : EMPTY_ASSIGNMENTS,
    updatedAt: null,
    loaded: !targetKey,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignments =
    state.key === targetKey
      ? state.assignments
      : competitionId && teamId
        ? readLocalPlan(competitionId, teamId)
        : EMPTY_ASSIGNMENTS;
  const updatedAt = state.key === targetKey ? state.updatedAt : null;
  const loading = targetKey !== null && (state.key !== targetKey || !state.loaded);

  useEffect(() => {
    if (!competitionId || !teamId) return;
    const key = `${competitionId}:${teamId}`;
    let cancelled = false;
    api
      .get<TeamRaceLineupPlan>(`/competitions/${competitionId}/teams/${teamId}/race-lineup`)
      .then((res) => {
        if (cancelled) return;
        const payload = ((res as { data?: TeamRaceLineupPlan })?.data ?? res) as TeamRaceLineupPlan | undefined;
        if (!payload || typeof payload.assignments !== 'object' || payload.assignments === null) {
          setState({ key, assignments: readLocalPlan(competitionId, teamId), updatedAt: null, loaded: true });
          return;
        }
        const hasServerPlan = Object.keys(payload.assignments).length > 0 || Boolean(payload.updatedAt);
        const nextAssignments = hasServerPlan ? payload.assignments : readLocalPlan(competitionId, teamId);
        if (hasServerPlan) {
          writeLocalPlan(competitionId, teamId, payload.assignments);
        }
        setState({ key, assignments: nextAssignments, updatedAt: payload.updatedAt ?? null, loaded: true });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ key, assignments: readLocalPlan(competitionId, teamId), updatedAt: null, loaded: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId, teamId]);

  const saveAssignments = useCallback(
    async (
      next: Record<string, Record<string, RiderRaceRole | string>>,
    ): Promise<Record<string, Record<string, RiderRaceRole | string>>> => {
      setState((prev) => ({
        key: targetKey,
        assignments: next,
        updatedAt: prev.key === targetKey ? prev.updatedAt : null,
        loaded: true,
      }));
      if (!competitionId || !teamId) return next;
      writeLocalPlan(competitionId, teamId, next);
      if (typeof api.put !== 'function') return next;
      setSaving(true);
      setError(null);
      try {
        const res = await api.put<TeamRaceLineupPlan>(
          `/competitions/${competitionId}/teams/${teamId}/race-lineup`,
          { assignments: next },
        );
        const saved = ((res as { data?: TeamRaceLineupPlan })?.data ?? res) as TeamRaceLineupPlan | undefined;
        if (saved?.assignments) {
          setState({
            key: targetKey,
            assignments: saved.assignments,
            updatedAt: saved.updatedAt ?? null,
            loaded: true,
          });
          writeLocalPlan(competitionId, teamId, saved.assignments);
          return saved.assignments;
        }
        return next;
      } catch (err) {
        setError((err as Error).message || 'Saved on this device; could not sync with server.');
        return next;
      } finally {
        setSaving(false);
      }
    },
    [competitionId, targetKey, teamId],
  );

  const setRaceRow = useCallback(
    async (
      raceKey: string,
      row: Record<string, RiderRaceRole | string>,
    ): Promise<Record<string, Record<string, RiderRaceRole | string>>> => {
      const next = { ...assignments, [raceKey]: row };
      return saveAssignments(next);
    },
    [assignments, saveAssignments],
  );

  return { assignments, updatedAt, loading, saving, error, saveAssignments, setRaceRow };
}
