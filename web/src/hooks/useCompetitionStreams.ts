import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { LiveStream, LiveStreamsResponse } from '../types';
import { updateStreams } from '../lib/streams';

/** Replay events received during GET so a late snapshot cannot undo a live update. */
export function useCompetitionStreams(competitionId: number, ready: number) {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [streamingEnabled, setEnabled] = useState(false);
  // False until the server has answered, so "not set up" is never shown while still asking.
  const [streamingChecked, setChecked] = useState(false);
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
        // An API without streaming answers unknown routes with the app's HTML page, so anything
        // that isn't a streams response means streaming is off rather than an empty list to trust.
        const valid = typeof data === 'object' && data !== null && Array.isArray(data.streams);
        setEnabled(valid && data.enabled === true);
        setChecked(true);
        setStreams(journal.reduce((current, change) => change(current), valid ? data.streams : []));
      }).catch(() => { /* Keep the last confirmed list; onReady retries. */ })
      .finally(() => { if (pending.current === journal) pending.current = null; });
    return () => { controller.abort(); };
  }, [competitionId, ready]);
  return { streams, streamingEnabled, streamingChecked, onStreamUpdated, onStreamViewers };
}
