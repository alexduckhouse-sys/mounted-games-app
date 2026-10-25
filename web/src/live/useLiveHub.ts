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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending: { key?: string; deliver: () => void }[] = [];
    // Events from a replaced connection never reach the current competition.
    const forward = <A extends unknown[]>(deliver: (...args: A) => void) => (...args: A) => { if (active) deliver(...args); };
    // Batch data changes in order: session and result events can contain partial updates.
    // Only replace telemetry/viewer totals, and only for the same stream.
    const forwardCoalesced = <A extends unknown[]>(event: string, deliver: (...args: A) => void) => forward((...args: A) => {
      if (!isLiteModeActive()) {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        for (const item of pending.splice(0)) item.deliver();
        deliver(...args);
        return;
      }
      const payload = args[0] as { streamId?: unknown } | undefined;
      const key = (event === 'streamTelemetry' || event === 'streamViewers') && typeof payload?.streamId === 'number'
        ? `${event}:${payload.streamId}` : undefined;
      if (key) {
        const previous = pending.findIndex((item) => item.key === key);
        if (previous >= 0) pending.splice(previous, 1);
      }
      pending.push({ key, deliver: () => deliver(...args) });
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (active) for (const item of pending.splice(0)) item.deliver();
      }, LITE_HUB_COALESCE_MS);
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
      if (timer !== undefined) clearTimeout(timer);
      pending.length = 0;
      // React runs this before the next effect, so the refs always hold this connection here.
      connectionRef.current = null;
      recoveryRef.current = null;
      window.removeEventListener('online', recovery.reconnect);
      recovery.dispose();
    };
  }, [competitionId, token]);

  return { connected, invoke, reconnect };
}
