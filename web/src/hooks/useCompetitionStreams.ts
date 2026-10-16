import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { LiveStream, LiveStreamsResponse } from '../types';
import { updateStreams } from '../lib/streams';

/** Replay events received during GET so a late snapshot cannot undo a live update. */
export function useCompetitionStreams(competitionId: number, ready: number) {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [streamingEnabled, setEnabled] = useState(false);
  const pending = useRef<((streams: LiveStream[]) => LiveStream[])[] | null>(null);
  const apply = useCallback((change: (streams: LiveStream[]) => LiveStream[]) => {
    pending.current?.push(change);
    setStreams(change);
  }, []);
  const onStreamUpdated = useCallback((stream: LiveStream) => {
    if (stream.competitionId === competitionId) apply((current) => updateStreams(current, stream));
  }, [apply, competitionId]);
  const onStreamViewers = useCallback(({ streamId, count }: { streamId: number; count: number }) => {
    apply((current) => current.map((stream) => stream.id === streamId ? { ...stream, viewerCount: count } : stream));
  }, [apply]);
  useEffect(() => {
    const controller = new AbortController();
    const journal: ((streams: LiveStream[]) => LiveStream[])[] = [];
    pending.current = journal;
    api.get<LiveStreamsResponse>(`/competitions/${competitionId}/streams`, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setEnabled(data.enabled);
        setStreams(journal.reduce((current, change) => change(current), data.streams));
      }).catch(() => { /* Keep the last confirmed list; onReady retries. */ })
      .finally(() => { if (pending.current === journal) pending.current = null; });
    return () => { controller.abort(); };
  }, [competitionId, ready]);
  return { streams, streamingEnabled, onStreamUpdated, onStreamViewers };
}
