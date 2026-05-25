import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useEffect, useRef, useState } from 'react';
import { readToken } from '../api';

export interface LiveHandlers {
  onChatMessage?: (msg: unknown) => void;
  onChatMessageDeleted?: (payload: { id: number }) => void;
  onSessionUpdated?: (session: unknown) => void;
  onResultsUpdated?: (payload: unknown) => void;
  onAnnouncement?: (msg: unknown) => void;
  onStewardCall?: (call: unknown) => void;
  onStewardCallResolved?: (payload: { id: number }) => void;
}

export function useLiveHub(competitionId: number | null, handlers: LiveHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (competitionId == null) return;
    const token = readToken();
    // Anonymous connections are allowed (steward / public timetable use them);
    // attach the token only when we have one so authed-only features still work.
    const url = token
      ? `/hubs/live?access_token=${encodeURIComponent(token)}`
      : '/hubs/live';

    const conn: HubConnection = new HubConnectionBuilder()
      .withUrl(url)
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    conn.on('chatMessage', (m) => handlersRef.current.onChatMessage?.(m));
    conn.on('chatMessageDeleted', (p) => handlersRef.current.onChatMessageDeleted?.(p as { id: number }));
    conn.on('sessionUpdated', (s) => handlersRef.current.onSessionUpdated?.(s));
    conn.on('resultsUpdated', (p) => handlersRef.current.onResultsUpdated?.(p));
    conn.on('announcement', (a) => handlersRef.current.onAnnouncement?.(a));
    conn.on('stewardCall', (c) => handlersRef.current.onStewardCall?.(c));
    conn.on('stewardCallResolved', (p) => handlersRef.current.onStewardCallResolved?.(p as { id: number }));

    let cancelled = false;
    conn.start()
      .then(() => conn.invoke('JoinCompetition', competitionId))
      .then(() => { if (!cancelled) setConnected(true); })
      .catch(() => { /* swallow — UI will fall back to polling */ });

    return () => {
      cancelled = true;
      setConnected(false);
      conn.invoke('LeaveCompetition', competitionId).catch(() => {});
      conn.stop().catch(() => {});
    };
  }, [competitionId]);

  return { connected };
}
