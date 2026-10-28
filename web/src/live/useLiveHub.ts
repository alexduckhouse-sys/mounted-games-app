import { HttpTransportType, HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recoverConnection } from './recoverConnection';
import { useAuth } from '../auth/AuthContext';
import { isLiteModeActive } from '../lite/liteMode';
import type { LiveStream, StreamCommand, StreamTelemetry } from '../types';
import type { StreamInvoke } from './streamRuntime';
import { readToken } from '../api';

export const LITE_HUB_COALESCE_MS = 1000;

interface SharedHubSubscriber {
  onStatus: (connected: boolean) => void;
  onReady: () => void;
  deliver: <A extends unknown[]>(fn: (handlers: LiveHandlers, ...args: A) => void, ...args: A) => void;
  deliverCoalesced: <A extends unknown[]>(event: string, fn: (handlers: LiveHandlers, ...args: A) => void, ...args: A) => void;
}

interface SharedHubEntry {
  conn: HubConnection;
  recovery: { reconnect: () => void; dispose: () => void };
  connected: boolean;
  subscribers: Set<SharedHubSubscriber>;
}

const sharedHubs = new Map<string, SharedHubEntry>();

export interface LiveHandlers {
  onStreamUpdated?: (stream: LiveStream) => void;
  onStreamViewers?: (payload: { streamId: number; count: number }) => void;
  onStreamTelemetry?: (telemetry: StreamTelemetry) => void;
  onStreamCommand?: (command: StreamCommand) => void;
  onOverlayUpdated?: (overlay: unknown) => void;
  onScoreCardControl?: (control: unknown) => void;
  onSponsorControl?: (control: unknown) => void;
  onPrizeGiving?: (prizeGiving: unknown) => void;
  onReady?: () => void;
  onChatMessage?: (msg: unknown) => void;
  onChatMessageDeleted?: (payload: { id: number }) => void;
  onSessionUpdated?: (session: unknown) => void;
  onResultsUpdated?: (payload: unknown) => void;
  onAnnouncement?: (msg: unknown) => void;
  /** Staff only: the competition's protests changed, so re-read them. The payload carries nothing else. */
  onProtestsChanged?: () => void;
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
    const hubUrl = import.meta.env.VITE_LIVE_HUB_URL || '/hubs/live';
    const hubKey = `${hubUrl}|${competitionId}|${token ?? ''}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending: { key?: string; deliver: () => void }[] = [];

    const subscriber: SharedHubSubscriber = {
      onStatus: (value: boolean) => {
        if (!active) return;
        readyRef.current = value;
        setConnectionState({ competitionId, token, connected: value });
      },
      onReady: () => { if (active) handlersRef.current.onReady?.(); },
      deliver: (fn, ...args) => { if (active) fn(handlersRef.current, ...args); },
      deliverCoalesced: (event, fn, ...args) => {
        if (!active) return;
        if (!isLiteModeActive()) {
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
          for (const item of pending.splice(0)) item.deliver();
          fn(handlersRef.current, ...args);
          return;
        }
        const payload = args[0] as { streamId?: unknown } | undefined;
        const key = (event === 'streamTelemetry' || event === 'streamViewers') && typeof payload?.streamId === 'number'
          ? `${event}:${payload.streamId}` : undefined;
        if (key) {
          const previous = pending.findIndex((item) => item.key === key);
          if (previous >= 0) pending.splice(previous, 1);
        }
        pending.push({ key, deliver: () => fn(handlersRef.current, ...args) });
        if (timer !== undefined) return;
        timer = setTimeout(() => {
          timer = undefined;
          if (active) for (const item of pending.splice(0)) item.deliver();
        }, LITE_HUB_COALESCE_MS);
      },
    };

    let entry = sharedHubs.get(hubKey);
    if (!entry) {
      const subscribers = new Set<SharedHubSubscriber>();
      const conn: HubConnection = new HubConnectionBuilder()
        .withUrl(hubUrl, {
          accessTokenFactory: () => readToken() === token ? token ?? '' : '',
          // The API can run as several instances with no sticky sessions, so connect straight over
          // WebSockets: a separate negotiate request could reach a different instance.
          skipNegotiation: true,
          transport: HttpTransportType.WebSockets,
        })
        .withAutomaticReconnect()
        .configureLogging(LogLevel.Warning)
        .build();

      const broadcast = <A extends unknown[]>(fn: (h: LiveHandlers, ...a: A) => void) => (...args: A) => {
        for (const sub of subscribers) sub.deliver(fn, ...args);
      };
      const broadcastCoalesced = <A extends unknown[]>(event: string, fn: (h: LiveHandlers, ...a: A) => void) => (...args: A) => {
        for (const sub of subscribers) sub.deliverCoalesced(event, fn, ...args);
      };

      conn.on('streamUpdated', broadcast((h, s) => h.onStreamUpdated?.(s as LiveStream)));
      conn.on('streamTelemetry', broadcastCoalesced('streamTelemetry', (h, t) => h.onStreamTelemetry?.(t as StreamTelemetry)));
      conn.on('streamCommand', broadcast((h, c) => h.onStreamCommand?.(c as StreamCommand)));
      conn.on('overlayUpdated', broadcast((h, o) => h.onOverlayUpdated?.(o)));
      conn.on('scoreCardControl', broadcast((h, c) => h.onScoreCardControl?.(c)));
      conn.on('sponsorControl', broadcast((h, c) => h.onSponsorControl?.(c)));
      conn.on('prizeGiving', broadcast((h, p) => h.onPrizeGiving?.(p)));
      conn.on('streamViewers', broadcastCoalesced('streamViewers', (h, p) => h.onStreamViewers?.(p as { streamId: number; count: number })));
      conn.on('chatMessage', broadcast((h, m) => h.onChatMessage?.(m)));
      conn.on('chatMessageDeleted', broadcast((h, p) => h.onChatMessageDeleted?.(p as { id: number })));
      conn.on('sessionUpdated', broadcastCoalesced('sessionUpdated', (h, s) => h.onSessionUpdated?.(s)));
      conn.on('resultsUpdated', broadcastCoalesced('resultsUpdated', (h, p) => h.onResultsUpdated?.(p)));
      conn.on('announcement', broadcast((h, a) => h.onAnnouncement?.(a)));
      conn.on('protestsChanged', broadcast((h) => h.onProtestsChanged?.()));

      const createdEntry: SharedHubEntry = {
        conn,
        connected: false,
        subscribers,
        recovery: null as unknown as { reconnect: () => void; dispose: () => void },
      };
      subscribers.add(subscriber);
      const recovery = recoverConnection({
        connection: conn,
        competitionId,
        online: () => navigator.onLine,
        onStatus: (value: boolean) => {
          createdEntry.connected = value;
          for (const sub of subscribers) sub.onStatus(value);
        },
        onReady: () => {
          for (const sub of subscribers) sub.onReady();
        },
        schedule: (callback, delay) => {
          const retryTimer = setTimeout(callback, delay);
          return () => clearTimeout(retryTimer);
        },
      });
      createdEntry.recovery = recovery;
      entry = createdEntry;
      sharedHubs.set(hubKey, entry);
      window.addEventListener('online', recovery.reconnect);
    } else {
      entry.subscribers.add(subscriber);
      if (entry.connected) { subscriber.onStatus(true); subscriber.onReady(); }
    }

    connectionRef.current = entry.conn;
    recoveryRef.current = entry.recovery;
    return () => {
      active = false;
      readyRef.current = false;
      if (timer !== undefined) clearTimeout(timer);
      pending.length = 0;
      connectionRef.current = null;
      recoveryRef.current = null;
      entry.subscribers.delete(subscriber);
      if (entry.subscribers.size === 0) {
        sharedHubs.delete(hubKey);
        window.removeEventListener('online', entry.recovery.reconnect);
        entry.recovery.dispose();
      }
    };
  }, [competitionId, token]);

  return { connected, invoke, reconnect };
}
