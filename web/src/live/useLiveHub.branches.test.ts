import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LITE_HUB_COALESCE_MS, useLiveHub } from './useLiveHub';

const auth = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ token: auth.token }) }));

class FakeConnection {
  state = 'Disconnected';
  handlers = new Map<string, (payload: unknown) => void>();
  start = vi.fn(async () => { this.state = 'Connected'; });
  stop = vi.fn(async () => { this.state = 'Disconnected'; });
  invoke = vi.fn(async () => undefined);
  on(event: string, handler: (payload: unknown) => void) { this.handlers.set(event, handler); }
  onreconnecting() {}
  onreconnected() {}
  onclose() {}
  emit(event: string, payload: unknown) { this.handlers.get(event)?.(payload); }
}

const hub = vi.hoisted(() => ({ connections: [] as unknown[] }));

vi.mock('@microsoft/signalr', () => ({
  LogLevel: { Warning: 3 },
  HttpTransportType: { WebSockets: 1 },
  HubConnectionBuilder: class {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() { return hub.connections.at(-1); }
  },
}));

const next = () => { const connection = new FakeConnection(); hub.connections.push(connection); return connection; };
const flush = () => act(async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); });

beforeEach(() => {
  auth.token = null;
  hub.connections.length = 0;
});

describe('useLiveHub shared connections', () => {
  it('lets a second page on the same competition join an already connected hub', async () => {
    const connection = next();
    const first = renderHook(() => useLiveHub(1, {}));
    await flush();
    expect(first.result.current.connected).toBe(true);

    const onReady = vi.fn();
    const second = renderHook(() => useLiveHub(1, { onReady }));
    expect(second.result.current.connected).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(connection.start).toHaveBeenCalledTimes(1);

    // The shared connection stays open until the last page lets go.
    first.unmount();
    expect(connection.stop).not.toHaveBeenCalled();
    second.unmount();
    await flush();
    expect(connection.stop).toHaveBeenCalled();
  });

  it('shares a hub that is still connecting and reports status to both pages once it is up', async () => {
    next();
    const onReadyA = vi.fn();
    const onReadyB = vi.fn();
    const a = renderHook(() => useLiveHub(1, { onReady: onReadyA }));
    const b = renderHook(() => useLiveHub(1, { onReady: onReadyB }));
    expect(b.result.current.connected).toBe(false);
    await flush();
    expect(a.result.current.connected).toBe(true);
    expect(b.result.current.connected).toBe(true);
    expect(onReadyA).toHaveBeenCalledTimes(1);
    expect(onReadyB).toHaveBeenCalledTimes(1);
    a.unmount();
    b.unmount();
  });

  it('delivers events to every page that shares the connection', async () => {
    const connection = next();
    const onChatMessage = vi.fn();
    const a = renderHook(() => useLiveHub(1, { onChatMessage }));
    const onChatB = vi.fn();
    const b = renderHook(() => useLiveHub(1, { onChatMessage: onChatB }));
    await flush();
    connection.emit('chatMessage', { id: 1 });
    expect(onChatMessage).toHaveBeenCalledWith({ id: 1 });
    expect(onChatB).toHaveBeenCalledWith({ id: 1 });
    a.unmount();
    connection.emit('chatMessage', { id: 2 });
    expect(onChatMessage).toHaveBeenCalledTimes(1);
    expect(onChatB).toHaveBeenCalledTimes(2);
    b.unmount();
  });
});

describe('useLiveHub Lite Mode switching', () => {
  it('delivers queued events straight away once Lite Mode is switched off mid-burst', async () => {
    vi.useFakeTimers();
    document.documentElement.dataset.lite = 'true';
    try {
      const connection = next();
      const onSessionUpdated = vi.fn();
      const onResultsUpdated = vi.fn();
      const { unmount } = renderHook(() => useLiveHub(1, { onSessionUpdated, onResultsUpdated }));
      await flush();

      connection.emit('sessionUpdated', { id: 1 });
      expect(onSessionUpdated).not.toHaveBeenCalled();

      delete document.documentElement.dataset.lite;
      connection.emit('resultsUpdated', { raceId: 5 });
      expect(onSessionUpdated).toHaveBeenCalledWith({ id: 1 });
      expect(onResultsUpdated).toHaveBeenCalledWith({ raceId: 5 });

      // The timer was cancelled, so nothing is delivered twice later.
      await act(async () => { await vi.advanceTimersByTimeAsync(LITE_HUB_COALESCE_MS * 2); });
      expect(onSessionUpdated).toHaveBeenCalledTimes(1);
      expect(onResultsUpdated).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      delete document.documentElement.dataset.lite;
      vi.useRealTimers();
    }
  });

  it('batches events without a stream id on their own, even for stream events', async () => {
    vi.useFakeTimers();
    document.documentElement.dataset.lite = 'true';
    try {
      const connection = next();
      const onStreamViewers = vi.fn();
      const { unmount } = renderHook(() => useLiveHub(1, { onStreamViewers }));
      await flush();
      connection.emit('streamViewers', { count: 1 });
      connection.emit('streamViewers', { count: 2 });
      connection.emit('streamViewers', undefined);
      await act(async () => { await vi.advanceTimersByTimeAsync(LITE_HUB_COALESCE_MS); });
      expect(onStreamViewers).toHaveBeenCalledTimes(3);
      unmount();
    } finally {
      delete document.documentElement.dataset.lite;
      vi.useRealTimers();
    }
  });
});
