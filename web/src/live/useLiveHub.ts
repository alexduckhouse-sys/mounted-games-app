import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recoverConnection } from './recoverConnection';
import type { LiveStream } from '../types';
import type { StreamInvoke } from './streamRuntime';
import { readToken } from '../api';

export interface LiveHandlers {
  onStreamUpdated?: (stream: LiveStream) => void;
  onStreamViewers?: (payload: { streamId: number; count: number }) => void;
  onReady?: () => void;
  onChatMessage?: (msg: unknown) => void;
  onChatMessageDeleted?: (payload: { id: number }) => void;
  onSessionUpdated?: (session: unknown) => void;
  onResultsUpdated?: (payload: unknown) => void;
  onAnnouncement?: (msg: unknown) => void;
}

export function useLiveHub(competitionId: number | null, handlers: LiveHandlers) {
  const connectionRef = useRef<HubConnection | null>(null);
  const readyRef = useRef(false);
  const invoke = useCallback<StreamInvoke>((method, ...args) => {
    if (!readyRef.current || !connectionRef.current || connectionRef.current.state !== 'Connected') return Promise.reject(new Error('Live connection is not ready'));
    return connectionRef.current.invoke(method, ...args);
  }, []);
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; }, [handlers]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (competitionId == null) return;
    const conn: HubConnection = new HubConnectionBuilder()
      .withUrl(import.meta.env.VITE_LIVE_HUB_URL || '/hubs/live', { accessTokenFactory: () => readToken() ?? '' })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    connectionRef.current = conn;
    conn.on('streamUpdated', (s) => handlersRef.current.onStreamUpdated?.(s as LiveStream));
    conn.on('streamViewers', (p) => handlersRef.current.onStreamViewers?.(p as { streamId: number; count: number }));
    conn.on('chatMessage', (m) => handlersRef.current.onChatMessage?.(m));
    conn.on('chatMessageDeleted', (p) => handlersRef.current.onChatMessageDeleted?.(p as { id: number }));
    conn.on('sessionUpdated', (s) => handlersRef.current.onSessionUpdated?.(s));
    conn.on('resultsUpdated', (p) => handlersRef.current.onResultsUpdated?.(p));
    conn.on('announcement', (a) => handlersRef.current.onAnnouncement?.(a));

    const recovery = recoverConnection({
      connection: conn,
      competitionId,
      online: () => navigator.onLine,
      onStatus: (value) => { readyRef.current = value; setConnected(value); },
      onReady: () => handlersRef.current.onReady?.(),
      schedule: (callback, delay) => {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
    });
    window.addEventListener('online', recovery.reconnect);
    return () => {
      readyRef.current = false;
      connectionRef.current = null;
      window.removeEventListener('online', recovery.reconnect);
      recovery.dispose();
    };
  }, [competitionId]);

  return { connected, invoke };
}
