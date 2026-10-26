import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { EMPTY_DRAW_UNDO_STATUS, parseDrawUndoResult, parseDrawUndoStatus } from '../lib/drawUndo';
import type { DrawUndoResult, DrawUndoStatus } from '../types';

export interface UseDrawUndoReturn {
  undoStatus: DrawUndoStatus;
  loading: boolean;
  restoring: boolean;
  error: string | null;
  refresh: () => Promise<DrawUndoStatus>;
  undo: () => Promise<DrawUndoResult | null>;
}

/**
 * Fetches and triggers the 30-minute safe undo snapshot for accidental heat deletion or redraw
 * (`GET /competitions/:id/draw-undo` and `POST /competitions/:id/draw-undo`).
 */
export function useDrawUndo(competitionId: number | null | undefined, autoLoad: boolean = true): UseDrawUndoReturn {
  const [undoStatus, setUndoStatus] = useState<DrawUndoStatus>(EMPTY_DRAW_UNDO_STATUS);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<DrawUndoStatus> => {
    if (!competitionId || competitionId <= 0) {
      setUndoStatus(EMPTY_DRAW_UNDO_STATUS);
      return EMPTY_DRAW_UNDO_STATUS;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<DrawUndoStatus>(`/competitions/${competitionId}/draw-undo`);
      const payload = (res as { data?: unknown })?.data ?? res;
      const parsed = parseDrawUndoStatus(payload);
      setUndoStatus(parsed);
      return parsed;
    } catch (err) {
      setError((err as Error).message || 'Could not check undo status.');
      return EMPTY_DRAW_UNDO_STATUS;
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  const undo = useCallback(async (): Promise<DrawUndoResult | null> => {
    if (!competitionId || competitionId <= 0) return null;
    setRestoring(true);
    setError(null);
    try {
      const res = await api.post<DrawUndoResult>(`/competitions/${competitionId}/draw-undo`, {});
      const payload = (res as { data?: unknown })?.data ?? res;
      const parsed = parseDrawUndoResult(payload);
      if (parsed) {
        setUndoStatus(parsed.undoStatus);
      } else {
        await refresh();
      }
      return parsed;
    } catch (err) {
      setError((err as Error).message || 'Could not undo the last change.');
      throw err;
    } finally {
      setRestoring(false);
    }
  }, [competitionId, refresh]);

  useEffect(() => {
    if (!autoLoad || !competitionId || competitionId <= 0) return;
    let cancelled = false;
    api
      .get<DrawUndoStatus>(`/competitions/${competitionId}/draw-undo`)
      .then((res) => {
        if (cancelled) return;
        const payload = (res as { data?: unknown })?.data ?? res;
        setUndoStatus(parseDrawUndoStatus(payload));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError((err as Error)?.message || 'Could not check undo status.');
      });
    return () => {
      cancelled = true;
    };
  }, [autoLoad, competitionId]);

  return { undoStatus, loading, restoring, error, refresh, undo };
}
