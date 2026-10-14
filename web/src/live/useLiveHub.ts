import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useEffect, useRef, useState } from 'react';
import { recoverConnection } from './recoverConnection';
import { readToken } from '../api';

export interface LiveHandlers {
  onReady?: () => void;
  onChatMessage?: (msg: unknown) => void;
  onChatMessageDeleted?: (payload: { id: number }) => void;
  onSessionUpdated?: (session: unknown) => void;
  onResultsUpdated?: (payload: unknown) => void;
  onAnnouncement?: (msg: unknown) => void;
}

export function useLiveHub(competitionId: number | null, handlers: LiveHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (competitionId == null) return;
    const conn: HubConnection = new HubConnectionBuilder()
      .withUrl('/hubs/live', { accessTokenFactory: () => readToken() ?? '' })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    conn.on('chatMessage', (m) => handlersRef.current.onChatMessage?.(m));
    conn.on('chatMessageDeleted', (p) => handlersRef.current.onChatMessageDeleted?.(p as { id: number }));
    conn.on('sessionUpdated', (s) => handlersRef.current.onSessionUpdated?.(s));
    conn.on('resultsUpdated', (p) => handlersRef.current.onResultsUpdated?.(p));
    conn.on('announcement', (a) => handlersRef.current.onAnnouncement?.(a));

    const recovery = recoverConnection({
      connection: conn,
      competitionId,
      online: () => navigator.onLine,
      onStatus: setConnected,
      onReady: () => handlersRef.current.onReady?.(),
      schedule: (callback, delay) => {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
    });
    window.addEventListener('online', recovery.reconnect);
    return () => {
      window.removeEventListener('online', recovery.reconnect);
      recovery.dispose();
    };
  }, [competitionId]);

  return { connected };
}
