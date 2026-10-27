// Unused in web UI yet — reserved for iOS / upcoming collecting-ring gate-check UI wiring
import { useCallback, useState } from 'react';
import { api } from '../api';
import { applyGateCheckTag, getGateCheckStatus, isHeatReadyAtGate, nextGateCheckStatus } from '../lib/gateCheck';
import { scorerApi } from '../offline/scorerLink';
import type { GateCheckStatus, Heat, Session } from '../types';

export interface UseGateCheckOptions {
  competitionId?: number;
  viaLink?: boolean;
  onSessionUpdated?: (session: Session) => void;
}

export function useGateCheck(options: UseGateCheckOptions = {}) {
  const { competitionId, viaLink = false, onSessionUpdated } = options;
  const [optimistic, setOptimistic] = useState<Record<string, GateCheckStatus>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const effectiveNotes = useCallback(
    (notes: string | null | undefined, heatId: number, entries?: { teamId: number }[]) => {
      let current = notes ?? null;
      if (entries) {
        for (const entry of entries) {
          const key = `${heatId}:${entry.teamId}`;
          if (key in optimistic) {
            current = applyGateCheckTag(current, heatId, entry.teamId, optimistic[key]);
          }
        }
      }
      return current;
    },
    [optimistic],
  );

  const getStatus = useCallback(
    (session: Pick<Session, 'notes'>, heatId: number, teamId: number): GateCheckStatus => {
      const key = `${heatId}:${teamId}`;
      if (key in optimistic) return optimistic[key];
      return getGateCheckStatus(session.notes, heatId, teamId);
    },
    [optimistic],
  );

  const setStatus = useCallback(
    async (
      session: Pick<Session, 'id' | 'notes'>,
      heatId: number,
      teamId: number,
      status: GateCheckStatus,
    ): Promise<Session | null> => {
      if (!viaLink && !competitionId) return null;
      const key = `${heatId}:${teamId}`;
      setOptimistic((prev) => ({ ...prev, [key]: status }));
      setSavingKey(key);
      try {
        const res = viaLink
          ? await scorerApi.put<Session>(`/scorer/heats/${heatId}/gate-check`, { teamId, status })
          : await api.put<Session>(
              `/competitions/${competitionId}/sessions/${session.id}/heats/${heatId}/gate-check`,
              { teamId, status },
            );
        setOptimistic((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        onSessionUpdated?.(res.data);
        return res.data;
      } catch {
        // Keep optimistic state if offline so the steward still sees lanes ready at the gate
        return null;
      } finally {
        setSavingKey((curr) => (curr === key ? null : curr));
      }
    },
    [competitionId, onSessionUpdated, viaLink],
  );

  const cycleStatus = useCallback(
    async (
      session: Pick<Session, 'id' | 'notes'>,
      heatId: number,
      teamId: number,
    ): Promise<Session | null> => {
      const current = getStatus(session, heatId, teamId);
      const next = nextGateCheckStatus(current);
      return setStatus(session, heatId, teamId, next);
    },
    [getStatus, setStatus],
  );

  const isReadyAtGate = useCallback(
    (session: Pick<Session, 'notes'>, heat: Pick<Heat, 'id' | 'entries'>): boolean => {
      const merged = effectiveNotes(session.notes, heat.id, heat.entries);
      return isHeatReadyAtGate(merged, heat);
    },
    [effectiveNotes],
  );

  return {
    getStatus,
    setStatus,
    cycleStatus,
    isReadyAtGate,
    savingKey,
  };
}
