import { HttpTransportType, HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recoverConnection } from './recoverConnection';
import { useAuth } from '../auth/AuthContext';
import { isLiteModeActive } from '../lite/liteMode';
import type { LiveStream, StreamCommand, StreamTelemetry } from '../types';
import type { StreamInvoke } from './streamRuntime';
import { readToken } from '../api';

export const LITE_HUB_COALESCE_MS = 1000;

export interface LiveHandlers {
  onStreamUpdated?: (stream: LiveStream) => void;
  onStreamViewers?: (payload: { streamId: number; count: number }) => void;
  onStreamTelemetry?: (telemetry: StreamTelemetry) => void;
  onStreamCommand?: (command: StreamCommand) => void;
  onOverlayUpdated?: (overlay: unknown) => void;
  onScoreCardControl?: (control: unknown) => void;
  onSponsorControl?: (control: unknown) => void;
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
  const recoveryRef = useRef<{ reconnect: () => void } | null>(null);
  /** Try the live link again now, e.g. when the user taps the connection pill. */
  const reconnect = useCallback(() => recoveryRef.current?.reconnect(), []);
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
        // The API can run as several instances with no sticky sessions, so connect straight over
        // WebSockets: a separate negotiate request could reach a different instance.
        skipNegotiation: true,
        transport: HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    connectionRef.current = conn;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const pending = new Map<string, () => void>();
    // Events from a connection that has been replaced (new competition or auth session) are dropped.
    const forward = <A extends unknown[]>(deliver: (...args: A) => void) => (...args: A) => { if (active) deliver(...args); };
    // In Lite Mode, coalesce rapid scoring/session/telemetry bursts over a short trailing window.
    const forwardCoalesced = <A extends unknown[]>(key: string, deliver: (...args: A) => void) => forward((...args: A) => {
      if (!isLiteModeActive()) {
        deliver(...args);
        return;
      }
      pending.set(key, () => deliver(...args));
      if (timers.has(key)) return;
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        const run = pending.get(key)!;
        pending.delete(key);
        run();
      }, LITE_HUB_COALESCE_MS));
    });
    conn.on('streamUpdated', forward((s) => handlersRef.current.onStreamUpdated?.(s as LiveStream)));
    conn.on('streamTelemetry', forwardCoalesced('streamTelemetry', (t) => handlersRef.current.onStreamTelemetry?.(t as StreamTelemetry)));
    conn.on('streamCommand', forward((c) => handlersRef.current.onStreamCommand?.(c as StreamCommand)));
    conn.on('overlayUpdated', forward((o) => handlersRef.current.onOverlayUpdated?.(o)));
    conn.on('scoreCardControl', forward((c) => handlersRef.current.onScoreCardControl?.(c)));
    conn.on('sponsorControl', forward((c) => handlersRef.current.onSponsorControl?.(c)));
    conn.on('streamViewers', forwardCoalesced('streamViewers', (p) => handlersRef.current.onStreamViewers?.(p as { streamId: number; count: number })));
    conn.on('chatMessage', forward((m) => handlersRef.current.onChatMessage?.(m)));
    conn.on('chatMessageDeleted', forward((p) => handlersRef.current.onChatMessageDeleted?.(p as { id: number })));
    conn.on('sessionUpdated', forwardCoalesced('sessionUpdated', (s) => handlersRef.current.onSessionUpdated?.(s)));
    conn.on('resultsUpdated', forwardCoalesced('resultsUpdated', (p) => handlersRef.current.onResultsUpdated?.(p)));
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
    recoveryRef.current = recovery;
    window.addEventListener('online', recovery.reconnect);
    return () => {
      active = false;
      readyRef.current = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pending.clear();
      // React runs this before the next effect, so the refs always hold this connection here.
      connectionRef.current = null;
      recoveryRef.current = null;
      window.removeEventListener('online', recovery.reconnect);
      recovery.dispose();
    };
  }, [competitionId, token]);

  return { connected, invoke, reconnect };
}
