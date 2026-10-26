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
export function useTeamRaceLineup(
  competitionId: number | null | undefined,
  teamId: number | null | undefined,
): UseTeamRaceLineupReturn {
  const [assignments, setAssignments] = useState<Record<string, Record<string, RiderRaceRole | string>>>(() =>
    competitionId && teamId ? readLocalPlan(competitionId, teamId) : {},
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!competitionId || !teamId) return;
    let cancelled = false;
    api
      .get<TeamRaceLineupPlan>(`/competitions/${competitionId}/teams/${teamId}/race-lineup`)
      .then((res) => {
        const payload = ((res as { data?: TeamRaceLineupPlan })?.data ?? res) as TeamRaceLineupPlan | undefined;
        if (cancelled || !payload || typeof payload.assignments !== 'object' || payload.assignments === null) return;
        if (Object.keys(payload.assignments).length > 0) {
          setAssignments(payload.assignments);
          writeLocalPlan(competitionId, teamId, payload.assignments);
        }
        setUpdatedAt(payload.updatedAt ?? null);
      })
      .catch(() => {
        // Keep local plan when offline or unauthenticated
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId, teamId]);

  const saveAssignments = useCallback(
    async (
      next: Record<string, Record<string, RiderRaceRole | string>>,
    ): Promise<Record<string, Record<string, RiderRaceRole | string>>> => {
      setAssignments(next);
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
          setAssignments(saved.assignments);
          writeLocalPlan(competitionId, teamId, saved.assignments);
          setUpdatedAt(saved.updatedAt ?? null);
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
    [competitionId, teamId],
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
