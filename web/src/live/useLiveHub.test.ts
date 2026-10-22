import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeStoredAuth } from '../api';
import { useLiveHub, type LiveHandlers } from './useLiveHub';

const auth = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ token: auth.token }) }));

class FakeConnection {
  state = 'Disconnected';
  handlers = new Map<string, (payload: unknown) => void>();
  reconnecting?: () => void;
  start = vi.fn(async () => { this.state = 'Connected'; });
  stop = vi.fn(async () => { this.state = 'Disconnected'; });
  invoke = vi.fn(async () => undefined);
  on(event: string, handler: (payload: unknown) => void) { this.handlers.set(event, handler); }
  onreconnecting(fn: () => void) { this.reconnecting = fn; }
  onreconnected() {}
  onclose() {}
  emit(event: string, payload: unknown) { this.handlers.get(event)?.(payload); }
}

const hub = vi.hoisted(() => ({
  connections: [] as unknown[],
  url: undefined as unknown,
  options: undefined as unknown,
  reconnect: false,
}));

vi.mock('@microsoft/signalr', () => ({
  LogLevel: { Warning: 3 },
  HttpTransportType: { WebSockets: 1 },
  HubConnectionBuilder: class {
    withUrl(url: string, options: unknown) { hub.url = url; hub.options = options; return this; }
    withAutomaticReconnect() { hub.reconnect = true; return this; }
    configureLogging() { return this; }
    build() { return hub.connections.at(-1); }
  },
}));

const next = () => { const connection = new FakeConnection(); hub.connections.push(connection); return connection; };
/** Lets the start/join promise chain finish. */
const flush = () => act(async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); });

beforeEach(() => {
  auth.token = null;
  hub.connections.length = 0;
  hub.reconnect = false;
  hub.url = undefined;
});

describe('useLiveHub', () => {
  it('does not connect without a competition', () => {
    const { result } = renderHook(() => useLiveHub(null, {}));
    expect(hub.connections).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });

  it('connects to the live hub, joins the competition and reports it is ready', async () => {
    const connection = next();
    const onReady = vi.fn();
    const { result } = renderHook(() => useLiveHub(12, { onReady }));
    await flush();
    expect(hub.url).toBe('/hubs/live');
    expect(hub.reconnect).toBe(true);
    expect(connection.start).toHaveBeenCalledTimes(1);
    expect(connection.invoke).toHaveBeenCalledWith('JoinCompetition', 12);
    expect(result.current.connected).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('shows as disconnected while the connection is reconnecting', async () => {
    const connection = next();
    const { result } = renderHook(() => useLiveHub(12, {}));
    await flush();
    act(() => connection.reconnecting!());
    expect(result.current.connected).toBe(false);
  });

  it('replaces the connection when the auth session changes and ignores the old connection', async () => {
    const first = next();
    const onChatMessage = vi.fn();
    const { rerender } = renderHook(() => useLiveHub(1, { onChatMessage }));
    await flush();
    const firstFactory = (hub.options as { accessTokenFactory: () => string }).accessTokenFactory;
    expect(firstFactory()).toBe('');

    const second = next();
    auth.token = 'fake-admin-token';
    writeStoredAuth({
      token: auth.token,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'fake-user', email: 'admin@example.test', fullName: 'Example Admin', clubId: null, clubName: null, roles: ['Admin'] },
    });
    rerender();
    await flush();

    const secondFactory = (hub.options as { accessTokenFactory: () => string }).accessTokenFactory;
    expect(first.stop).toHaveBeenCalledOnce();
    expect(secondFactory()).toBe('fake-admin-token');
    expect(second.invoke).toHaveBeenCalledWith('JoinCompetition', 1);
    first.emit('chatMessage', { id: 1 });
    second.emit('chatMessage', { id: 2 });

    const third = next();
    auth.token = null;
    writeStoredAuth(null);
    rerender();
    await flush();

    const thirdFactory = (hub.options as { accessTokenFactory: () => string }).accessTokenFactory;
    expect(second.stop).toHaveBeenCalledOnce();
    expect(thirdFactory()).toBe('');
    second.emit('chatMessage', { id: 3 });
    third.emit('chatMessage', { id: 4 });
    expect(onChatMessage.mock.calls).toEqual([[{ id: 2 }], [{ id: 4 }]]);
  });

  it('ignores status changes from a connection replaced by a new auth session', async () => {
    const first = next();
    const { result, rerender } = renderHook(() => useLiveHub(1, {}));
    await flush();
    expect(result.current.connected).toBe(true);

    next();
    auth.token = 'fake-admin-token';
    writeStoredAuth({
      token: auth.token,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'fake-user', email: 'admin@example.test', fullName: 'Example Admin', clubId: null, clubName: null, roles: ['Admin'] },
    });
    rerender();
    await flush();
    expect(result.current.connected).toBe(true);

    act(() => first.reconnecting?.());
    expect(result.current.connected).toBe(true);
    writeStoredAuth(null);
  });

  it('does not present an expired token when SignalR reconnects', () => {
    auth.token = 'expired-fake-token';
    writeStoredAuth({
      token: auth.token,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      user: { id: 'fake-user', email: 'admin@example.test', fullName: 'Example Admin', clubId: null, clubName: null, roles: ['Admin'] },
    });
    next();
    renderHook(() => useLiveHub(1, {}));
    const factory = (hub.options as { accessTokenFactory: () => string }).accessTokenFactory;
    expect(factory()).toBe('');
  });

  it('connects straight over WebSockets so every request reaches the same API instance', () => {
    next();
    renderHook(() => useLiveHub(1, {}));
    expect(hub.options).toMatchObject({ skipNegotiation: true, transport: 1 });
  });

  it('can be pointed at another hub with a build-time setting', () => {
    vi.stubEnv('VITE_LIVE_HUB_URL', 'https://live.example.com/hubs/live');
    next();
    renderHook(() => useLiveHub(1, {}));
    expect(hub.url).toBe('https://live.example.com/hubs/live');
  });

  it('passes each event to the matching handler', async () => {
    const connection = next();
    const handlers: Required<LiveHandlers> = {
      onStreamUpdated: vi.fn(), onStreamViewers: vi.fn(), onOverlayUpdated: vi.fn(),
      onReady: vi.fn(), onChatMessage: vi.fn(), onChatMessageDeleted: vi.fn(),
      onSessionUpdated: vi.fn(), onResultsUpdated: vi.fn(), onAnnouncement: vi.fn(),
    };
    renderHook(() => useLiveHub(1, handlers));
    await flush();
    connection.emit('chatMessage', { id: 1 });
    connection.emit('chatMessageDeleted', { id: 2 });
    connection.emit('sessionUpdated', { id: 3 });
    connection.emit('resultsUpdated', { id: 4 });
    connection.emit('announcement', { id: 5 });
    connection.emit('streamUpdated', { id: 6 });
    connection.emit('streamViewers', { streamId: 6, count: 12 });
    connection.emit('overlayUpdated', { revision: 7 });
    expect(handlers.onOverlayUpdated).toHaveBeenCalledWith({ revision: 7 });
    expect(handlers.onStreamUpdated).toHaveBeenCalledWith({ id: 6 });
    expect(handlers.onStreamViewers).toHaveBeenCalledWith({ streamId: 6, count: 12 });
    expect(handlers.onChatMessage).toHaveBeenCalledWith({ id: 1 });
    expect(handlers.onChatMessageDeleted).toHaveBeenCalledWith({ id: 2 });
    expect(handlers.onSessionUpdated).toHaveBeenCalledWith({ id: 3 });
    expect(handlers.onResultsUpdated).toHaveBeenCalledWith({ id: 4 });
    expect(handlers.onAnnouncement).toHaveBeenCalledWith({ id: 5 });
  });

  it('ignores events the page has no handler for', async () => {
    const connection = next();
    renderHook(() => useLiveHub(1, {}));
    await flush();
    for (const event of ['chatMessage', 'chatMessageDeleted', 'sessionUpdated', 'resultsUpdated', 'announcement', 'streamUpdated', 'streamViewers']) {
      expect(() => connection.emit(event, {})).not.toThrow();
    }
  });

  it('uses the latest handlers without reconnecting', async () => {
    const connection = next();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ handlers }) => useLiveHub(1, handlers), { initialProps: { handlers: { onChatMessage: first } as LiveHandlers } });
    await flush();
    rerender({ handlers: { onChatMessage: second } });
    connection.emit('chatMessage', 'hello');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('hello');
    expect(connection.start).toHaveBeenCalledTimes(1);
  });

  it('closes the old connection and opens a new one when the competition changes', async () => {
    const first = next();
    const { rerender } = renderHook(({ id }) => useLiveHub(id, {}), { initialProps: { id: 1 } });
    await flush();
    const second = next();
    rerender({ id: 2 });
    await flush();
    expect(first.stop).toHaveBeenCalled();
    expect(second.invoke).toHaveBeenCalledWith('JoinCompetition', 2);
  });

  it('tries again at once when asked, and does nothing once unmounted', async () => {
    const connection = next();
    connection.start.mockRejectedValueOnce(new Error('no signal'));
    const { result, unmount } = renderHook(() => useLiveHub(1, {}));
    await flush();
    expect(result.current.connected).toBe(false);
    act(() => result.current.reconnect());
    await flush();
    expect(connection.start).toHaveBeenCalledTimes(2);
    expect(result.current.connected).toBe(true);

    const { reconnect } = result.current;
    unmount();
    connection.state = 'Disconnected';
    reconnect();
    await flush();
    expect(connection.start).toHaveBeenCalledTimes(2);
  });

  it('retries as soon as the phone comes back online, and stops listening on unmount', async () => {
    const connection = next();
    connection.start.mockRejectedValueOnce(new Error('no signal'));
    const { result, unmount } = renderHook(() => useLiveHub(1, {}));
    await flush();
    expect(result.current.connected).toBe(false);
    act(() => { window.dispatchEvent(new Event('online')); });
    await flush();
    expect(connection.start).toHaveBeenCalledTimes(2);
    expect(result.current.connected).toBe(true);

    unmount();
    connection.state = 'Disconnected';
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(connection.start).toHaveBeenCalledTimes(2);
    expect(connection.stop).toHaveBeenCalled();
  });

  it('waits to retry with a timer when the first attempt fails and the phone is offline', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const connection = next();
      renderHook(() => useLiveHub(1, {}));
      expect(connection.start).not.toHaveBeenCalled();
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(connection.start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the pending retry on unmount', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const connection = next();
      const { unmount } = renderHook(() => useLiveHub(1, {}));
      unmount();
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(connection.start).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

it('invokes on the joined connection and rejects before joining, during recovery and after disposal', async () => {
  const connection = next();
  const { result, unmount } = renderHook(() => useLiveHub(1, {}));
  await expect(result.current.invoke('WatchStream', 1, 2)).rejects.toThrow('not ready');
  await flush();
  await result.current.invoke('WatchStream', 1, 2);
  expect(connection.invoke).toHaveBeenCalledWith('WatchStream', 1, 2);
  connection.state = 'Reconnecting';
  await expect(result.current.invoke('WatchStream', 1, 2)).rejects.toThrow('not ready');
  act(() => connection.reconnecting!());
  await expect(result.current.invoke('WatchStream', 1, 2)).rejects.toThrow('not ready');
  unmount();
  await expect(result.current.invoke('WatchStream', 1, 2)).rejects.toThrow('not ready');
});
