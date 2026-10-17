import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useEffect, useRef, useState } from 'react';
import { recoverConnection } from './recoverConnection';
import { useAuth } from '../auth/AuthContext';
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
  const { token } = useAuth();
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; }, [handlers]);
  const [connectionState, setConnectionState] = useState<{ competitionId: number | null; token: string | null; connected: boolean }>(
    () => ({ competitionId, token, connected: false }),
  );
  const connected = connectionState.competitionId === competitionId && connectionState.token === token
    ? connectionState.connected
    : false;

  useEffect(() => {
    if (competitionId == null) return;
    let active = true;
    const conn: HubConnection = new HubConnectionBuilder()
      .withUrl(import.meta.env.VITE_LIVE_HUB_URL || '/hubs/live', {
        accessTokenFactory: () => readToken() === token ? token ?? '' : '',
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    conn.on('chatMessage', (m) => { if (active) handlersRef.current.onChatMessage?.(m); });
    conn.on('chatMessageDeleted', (p) => { if (active) handlersRef.current.onChatMessageDeleted?.(p as { id: number }); });
    conn.on('sessionUpdated', (s) => { if (active) handlersRef.current.onSessionUpdated?.(s); });
    conn.on('resultsUpdated', (p) => { if (active) handlersRef.current.onResultsUpdated?.(p); });
    conn.on('announcement', (a) => { if (active) handlersRef.current.onAnnouncement?.(a); });

    const recovery = recoverConnection({
      connection: conn,
      competitionId,
      online: () => navigator.onLine,
      onStatus: (value) => { if (active) setConnectionState({ competitionId, token, connected: value }); },
      onReady: () => { if (active) handlersRef.current.onReady?.(); },
      schedule: (callback, delay) => {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
    });
    window.addEventListener('online', recovery.reconnect);
    return () => {
      active = false;
      window.removeEventListener('online', recovery.reconnect);
      recovery.dispose();
    };
  }, [competitionId, token]);

  return { connected };
}
