import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { pushSupported, readPushReadiness, subscribeForPush, unsubscribeFromPush } from './push';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const del = vi.mocked(api.delete);

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

function fakeSubscription(extra: Record<string, unknown> = {}) {
  const keys: Record<string, ArrayBuffer | null> = { p256dh: bytes(1, 2, 3), auth: bytes(255, 0) };
  return {
    endpoint: 'https://push.example/abc',
    getKey: vi.fn((name: string) => keys[name]),
    unsubscribe: vi.fn().mockResolvedValue(true),
    ...extra,
  };
}

function setup({ existing = null as ReturnType<typeof fakeSubscription> | null, permission = 'granted' } = {}) {
  const created = fakeSubscription();
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existing),
    subscribe: vi.fn().mockResolvedValue(created),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve({ pushManager }) }, configurable: true });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission });
  return { pushManager, created };
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('readPushReadiness', () => {
  afterEach(() => {
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('reports unsupported without accessing a service worker', async () => {
    expect(await readPushReadiness()).toBe('unsupported');
  });

  it.each(['default', 'denied'])('reports %s without prompting or reading subscriptions', async (permission) => {
    const { pushManager } = setup({ permission });
    const requestPermission = vi.fn();
    vi.stubGlobal('Notification', { permission, requestPermission });
    expect(await readPushReadiness()).toBe(permission);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
  });

  it('distinguishes permission from an actual browser subscription', async () => {
    const { pushManager } = setup();
    expect(await readPushReadiness()).toBe('not-subscribed');
    pushManager.getSubscription.mockResolvedValue(fakeSubscription());
    expect(await readPushReadiness()).toBe('ready');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('reports a failed subscription lookup and allows a later retry', async () => {
    const { pushManager } = setup();
    pushManager.getSubscription.mockRejectedValueOnce(new Error('Browser unavailable'));
    expect(await readPushReadiness()).toBe('error');
    expect(await readPushReadiness()).toBe('not-subscribed');
  });

  it('stops waiting for a subscription lookup that never resolves', async () => {
    vi.useFakeTimers();
    const { pushManager } = setup();
    pushManager.getSubscription.mockReturnValue(new Promise(() => {}));
    const pending = readPushReadiness();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('service worker readiness', () => {
  it.each([
    ['read', readPushReadiness, 'error'],
    ['subscribe', subscribeForPush, false],
    ['unsubscribe', unsubscribeFromPush, undefined],
  ] as const)('%s stops waiting and does not act when the worker becomes ready late', async (_, operation, expected) => {
    vi.useFakeTimers();
    const { pushManager } = setup();
    let finish!: (value: { pushManager: typeof pushManager }) => void;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: new Promise((resolve) => { finish = resolve; }) },
    });
    const pending = operation();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(expected);
    finish({ pushManager });
    await vi.advanceTimersByTimeAsync(0);
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['read', readPushReadiness, 'error'],
    ['subscribe', subscribeForPush, false],
    ['unsubscribe', unsubscribeFromPush, undefined],
  ] as const)('%s handles worker rejection and clears its timeout', async (_, operation, expected) => {
    vi.useFakeTimers();
    setup();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.reject(new Error('Worker unavailable')) },
    });
    expect(await operation()).toBe(expected);
    expect(vi.getTimerCount()).toBe(0);
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('clears the timer after a successful check', async () => {
    vi.useFakeTimers();
    setup({ existing: fakeSubscription() });
    expect(await readPushReadiness()).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('pushSupported', () => {
  it('needs a service worker, push manager and notifications', () => {
    expect(pushSupported()).toBe(false);
    setup();
    expect(pushSupported()).toBe(true);
  });

  it.each(['PushManager', 'Notification'])('is false without %s', (name) => {
    setup();
    Reflect.deleteProperty(globalThis, name);
    expect(pushSupported()).toBe(false);
  });

  it('is false without a service worker', () => {
    setup();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    expect(pushSupported()).toBe(false);
  });
});

describe('subscribeForPush', () => {
  beforeEach(() => {
    post.mockResolvedValue({ data: {} });
    get.mockResolvedValue({ data: { publicKey: 'AQID' } });
  });

  it('does nothing when push is unsupported', async () => {
    expect(await subscribeForPush()).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['default', 'denied'])('does nothing unless notifications are granted (%s)', async (permission) => {
    const { pushManager } = setup({ permission });
    expect(await subscribeForPush()).toBe(false);
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
  });

  it('re-registers an existing browser subscription with the server', async () => {
    const existing = fakeSubscription();
    const { pushManager } = setup({ existing });
    expect(await subscribeForPush()).toBe(true);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    // bytes 1,2,3 and 255,0 as base64
    expect(post).toHaveBeenCalledWith('/push/subscribe', { endpoint: 'https://push.example/abc', p256dh: 'AQID', auth: '/wA=' });
  });

  it('subscribes with the server’s public key and registers the result', async () => {
    const { pushManager, created } = setup();
    // URL-safe base64 with the padding left off: 0xFB 0xFF 0xFE 0x01.
    get.mockResolvedValue({ data: { publicKey: '-__-AQ' } });
    expect(await subscribeForPush()).toBe(true);
    expect(get).toHaveBeenCalledWith('/push/vapid-public-key');
    const { applicationServerKey, userVisibleOnly } = pushManager.subscribe.mock.calls[0][0];
    expect(userVisibleOnly).toBe(true);
    expect([...new Uint8Array(applicationServerKey as ArrayBuffer)]).toEqual([0xfb, 0xff, 0xfe, 0x01]);
    expect(post).toHaveBeenCalledWith('/push/subscribe', expect.objectContaining({ endpoint: created.endpoint }));
  });

  it('decodes keys that need one or two padding characters', async () => {
    const { pushManager } = setup();
    for (const [key, expected] of [['QQ', [0x41]], ['QUI', [0x41, 0x42]], ['QUJD', [0x41, 0x42, 0x43]]] as const) {
      get.mockResolvedValue({ data: { publicKey: key } });
      await subscribeForPush();
      const sent = pushManager.subscribe.mock.calls.at(-1)![0].applicationServerKey as ArrayBuffer;
      expect([...new Uint8Array(sent)]).toEqual(expected);
    }
  });

  it('gives up when the server has no public key', async () => {
    const { pushManager } = setup();
    get.mockResolvedValue({ data: { publicKey: '' } });
    expect(await subscribeForPush()).toBe(false);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('sends empty keys when the browser does not expose them', async () => {
    const existing = fakeSubscription({ getKey: vi.fn(() => null) });
    setup({ existing });
    await subscribeForPush();
    expect(post).toHaveBeenCalledWith('/push/subscribe', { endpoint: existing.endpoint, p256dh: '', auth: '' });
  });

  it('reports failure rather than throwing when the browser or server fails', async () => {
    const { pushManager } = setup();
    pushManager.subscribe.mockRejectedValue(new Error('denied'));
    expect(await subscribeForPush()).toBe(false);
    pushManager.subscribe.mockResolvedValue(fakeSubscription());
    post.mockRejectedValue(new Error('500'));
    expect(await subscribeForPush()).toBe(false);
    get.mockRejectedValue(new Error('offline'));
    expect(await subscribeForPush()).toBe(false);
  });
});

describe('unsubscribeFromPush', () => {
  beforeEach(() => {
    del.mockResolvedValue({ data: {} });
  });

  it('does nothing when push is unsupported', async () => {
    await unsubscribeFromPush();
    expect(del).not.toHaveBeenCalled();
  });

  it('unsubscribes the browser and tells the server which endpoint to forget', async () => {
    const existing = fakeSubscription();
    setup({ existing });
    await unsubscribeFromPush();
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/push/subscribe', { params: { endpoint: 'https://push.example/abc' } });
  });

  it('still succeeds when the server has already forgotten the endpoint', async () => {
    const existing = fakeSubscription();
    setup({ existing });
    del.mockRejectedValue(new Error('404'));
    await expect(unsubscribeFromPush()).resolves.toBeUndefined();
    expect(existing.unsubscribe).toHaveBeenCalled();
  });

  it('asks the server to drop any subscription when the browser has none', async () => {
    setup();
    await unsubscribeFromPush();
    expect(del).toHaveBeenCalledWith('/push/subscribe');
  });

  it('ignores a server failure when the browser has no subscription', async () => {
    setup();
    del.mockRejectedValue(new Error('offline'));
    await expect(unsubscribeFromPush()).resolves.toBeUndefined();
  });

  it('swallows browser errors', async () => {
    const existing = fakeSubscription({ unsubscribe: vi.fn().mockRejectedValue(new Error('boom')) });
    setup({ existing });
    await expect(unsubscribeFromPush()).resolves.toBeUndefined();
    expect(del).not.toHaveBeenCalled();
  });
});
