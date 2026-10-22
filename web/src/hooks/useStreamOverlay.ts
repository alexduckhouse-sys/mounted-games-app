import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { StreamOverlay } from '../types';
import { DEFAULT_OVERLAY, overlayRequest, parseOverlay } from '../lib/overlays';

export type OverlaySaveResult = 'saved' | 'conflict' | 'failed';

/**
 * The overlays drawn over a competition's video. Keeps whichever copy has the highest revision, so a slow
 * GET can't undo a live update. `save` sends the revision it last saw; on a clash it takes the server's copy.
 */
export function useStreamOverlay(competitionId: number, ready: number) {
  const [overlay, setOverlay] = useState<StreamOverlay>(DEFAULT_OVERLAY);
  const current = useRef(overlay);
  const adopt = useCallback((next: StreamOverlay) => {
    if (next.revision < current.current.revision) return;
    current.current = next;
    setOverlay(next);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.get<unknown>(`/competitions/${competitionId}/overlays`, { signal: controller.signal })
      .then(({ data }) => {
        const parsed = parseOverlay(data);
        if (!controller.signal.aborted && parsed) adopt(parsed);
      })
      .catch(() => { /* keep what we have; onReady fetches again */ });
    return () => controller.abort();
  }, [competitionId, ready, adopt]);

  const onOverlayUpdated = useCallback((raw: unknown) => {
    const parsed = parseOverlay(raw);
    if (parsed) adopt(parsed);
  }, [adopt]);

  const save = useCallback(async (change: (overlay: StreamOverlay) => StreamOverlay): Promise<OverlaySaveResult> => {
    const next = change(current.current);
    try {
      const { data } = await api.put<unknown>(`/competitions/${competitionId}/overlays`, overlayRequest(next));
      const parsed = parseOverlay(data);
      if (parsed) adopt(parsed);
      return 'saved';
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: unknown } }).response;
      if (response?.status !== 409) return 'failed';
      const latest = parseOverlay(response.data);
      if (latest) adopt(latest);
      return 'conflict';
    }
  }, [competitionId, adopt]);

  return { overlay, onOverlayUpdated, save };
}
