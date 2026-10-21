import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recoverConnection } from './recoverConnection';
import { useAuth } from '../auth/AuthContext';
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
  const { token } = useAuth();
  const connectionRef = useRef<HubConnection | null>(null);
  const readyRef = useRef(false);
  const invoke = useCallback<StreamInvoke>((method, ...args) => {
    if (!readyRef.current || !connectionRef.current || connectionRef.current.state !== 'Connected') return Promise.reject(new Error('Live connection is not ready'));
    return connectionRef.current.invoke(method, ...args);
  }, []);
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

    connectionRef.current = conn;
    // Events from a connection that has been replaced (new competition or auth session) are dropped.
    const forward = <A extends unknown[]>(deliver: (...args: A) => void) => (...args: A) => { if (active) deliver(...args); };
    conn.on('streamUpdated', forward((s) => handlersRef.current.onStreamUpdated?.(s as LiveStream)));
    conn.on('streamViewers', forward((p) => handlersRef.current.onStreamViewers?.(p as { streamId: number; count: number })));
    conn.on('chatMessage', forward((m) => handlersRef.current.onChatMessage?.(m)));
    conn.on('chatMessageDeleted', forward((p) => handlersRef.current.onChatMessageDeleted?.(p as { id: number })));
    conn.on('sessionUpdated', forward((s) => handlersRef.current.onSessionUpdated?.(s)));
    conn.on('resultsUpdated', forward((p) => handlersRef.current.onResultsUpdated?.(p)));
    conn.on('announcement', forward((a) => handlersRef.current.onAnnouncement?.(a)));

    const recovery = recoverConnection({
      connection: conn,
      competitionId,
      online: () => navigator.onLine,
      onStatus: forward((value: boolean) => {
        readyRef.current = value;
        setConnectionState({ competitionId, token, connected: value });
      }),
      onReady: forward(() => handlersRef.current.onReady?.()),
      schedule: (callback, delay) => {
        const timer = setTimeout(callback, delay);
        return () => clearTimeout(timer);
      },
    });
    window.addEventListener('online', recovery.reconnect);
    return () => {
      active = false;
      readyRef.current = false;
      if (connectionRef.current === conn) connectionRef.current = null;
      window.removeEventListener('online', recovery.reconnect);
      recovery.dispose();
    };
  }, [competitionId, token]);

  return { connected, invoke };
}
