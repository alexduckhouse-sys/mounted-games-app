import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamPublisher, type PublisherDependencies } from './streamPublisher';
import { streamClock } from './streamRuntime';
import { asMedia, deferred, FakeMediaStream, FakePeer, FakeTrack, flush, resetMedia } from '../test/streamFakes';

type Task = { callback: () => void; ms: number };

interface SetupOptions {
  /** When set, scheduled callbacks are recorded and cancelling them does nothing, so stale timers can be replayed. */
  manual?: boolean;
  PeerConnection?: typeof RTCPeerConnection;
}

function setup(options: SetupOptions = {}) {
  let hidden = false;
  let visibility!: () => void;
  const tasks: Task[] = [];
  const release = vi.fn(async () => {});
  const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
    if (path.endsWith('ice-servers')) return { iceServers: [] };
    if (path.endsWith('republish')) return { streamId: 1, attempt: 2, sdpAnswer: 'republished answer' };
    if (path.endsWith('streams')) return { streamId: 1, attempt: 1, sdpAnswer: 'answer' };
    return {};
  });
  const getUserMedia = vi.fn(
    async (constraints: MediaStreamConstraints) =>
      asMedia(new FakeMediaStream([...(constraints.video ? [new FakeTrack()] : []), ...(constraints.audio ? [new FakeTrack('audio')] : [])])),
  );
  const clock = options.manual
    ? {
        now: () => Date.now(),
        schedule: (callback: () => void, ms: number) => {
          tasks.push({ callback, ms });
          return () => {};
        },
      }
    : streamClock;
  const d: PublisherDependencies = {
    ...clock,
    request: request as PublisherDependencies['request'],
    getUserMedia,
    enumerateDevices: vi.fn(async () => []),
    PeerConnection: options.PeerConnection ?? (FakePeer as unknown as typeof RTCPeerConnection),
    wakeLock: vi.fn(async () => ({ release })),
    visibility: { hidden: () => hidden, listen: (fn) => { visibility = fn; return () => {}; } },
  };
  const publisher = createStreamPublisher(1, d);
  return {
    publisher,
    request,
    getUserMedia,
    tasks,
    hide: (value: boolean) => { hidden = value; visibility(); },
    start: async (sound = true) => { await publisher.capture(sound); await publisher.start('Main Arena', 'Main camera'); await flush(); },
  };
}

const statusError = (status: number) => ({ response: { status } });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); resetMedia(); });
afterEach(() => { vi.useRealTimers(); });

describe('publisher guards and defaults', () => {
  it('ignores reconnect requests while nothing is being published', () => {
    const { publisher: p, request } = setup();
    p.reconnect();
    expect(request).not.toHaveBeenCalled();
    expect(p.getSnapshot().state).toBe('idle');
    p.dispose();
  });

  it('copes with a capture that has no video track', async () => {
    const { publisher: p, getUserMedia } = setup();
    getUserMedia.mockResolvedValueOnce(asMedia(new FakeMediaStream([new FakeTrack('audio')])));
    await p.capture();
    expect(p.getSnapshot()).toMatchObject({ maxZoom: 3, captureResolution: '720p', hasAudio: true });
    p.dispose();
  });

  it('applies the default quality when none is stored, and builds parameters when the browser has none', async () => {
    const { publisher: p, start } = setup();
    await start();
    const sender = FakePeer.instances[0].transceivers[0].sender as unknown as Record<string, unknown>;
    const setParameters = vi.fn(async () => {});
    sender.getParameters = vi.fn(() => undefined);
    sender.setParameters = setParameters;
    await p.setQualityPreset(undefined as never);
    expect(setParameters).toHaveBeenCalledWith({ encodings: [], degradationPreference: 'maintain-framerate' });
    p.dispose();
  });

  it('does not treat a screen wake as a recovery trigger while media is still being captured', async () => {
    const { publisher: p, getUserMedia, hide } = setup();
    const capturing = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(capturing.promise);
    const starting = p.start('A', 'B');
    await flush();
    hide(true);
    hide(false);
    capturing.resolve(asMedia(new FakeMediaStream([new FakeTrack(), new FakeTrack('audio')])));
    await starting;
    await flush();
    expect(p.getSnapshot().state).toBe('live');
    p.dispose();
  });
});

describe('publisher cancellation at each negotiation step', () => {
  it('stops cleanly when stopped while the camera is still opening', async () => {
    const { publisher: p, getUserMedia, request } = setup();
    const capturing = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(capturing.promise);
    const starting = p.start('A', 'B');
    await flush();
    await p.stop();
    const media = new FakeMediaStream([new FakeTrack()]);
    capturing.resolve(asMedia(media));
    await starting;
    expect(media.tracks[0].stop).toHaveBeenCalled();
    expect(request.mock.calls.some(([, path]) => path.endsWith('ice-servers'))).toBe(false);
    p.dispose();
  });

  it('stops cleanly when stopped while the offer is being created', async () => {
    const offer = deferred<RTCSessionDescriptionInit>();
    class SlowOffer extends FakePeer {
      createOffer = vi.fn(() => offer.promise as never);
    }
    const { publisher: p, request } = setup({ PeerConnection: SlowOffer as unknown as typeof RTCPeerConnection });
    await p.capture();
    const starting = p.start('A', 'B');
    await flush();
    await p.stop();
    offer.resolve({ type: 'offer', sdp: 'late' });
    await starting;
    expect(request.mock.calls.some(([, path]) => path === '/competitions/1/streams')).toBe(false);
    p.dispose();
  });

  it('stops cleanly when stopped while the answer is being applied', async () => {
    const answer = deferred<void>();
    class SlowAnswer extends FakePeer {
      setRemoteDescription = vi.fn(() => answer.promise);
    }
    const { publisher: p, request } = setup({ PeerConnection: SlowAnswer as unknown as typeof RTCPeerConnection });
    await p.capture();
    const starting = p.start('A', 'B');
    await flush();
    await p.stop();
    answer.resolve();
    await starting;
    expect(request.mock.calls.some(([, path]) => path.endsWith('/ready'))).toBe(false);
    p.dispose();
  });

  it('does not confirm readiness when stopped the moment the connection comes up', async () => {
    const { publisher: p, request } = setup();
    FakePeer.connect = false;
    await p.capture();
    const starting = p.start('A', 'B');
    await flush();
    FakePeer.instances[0].change('connected');
    const stopping = p.stop();
    await stopping;
    await starting;
    expect(request.mock.calls.some(([, path]) => path.endsWith('/ready'))).toBe(false);
    expect(p.getSnapshot().state).toBe('ended');
    p.dispose();
  });
});

describe('publisher replayed stale timers', () => {
  it('ignores a retry timer that fires after the broadcast was stopped', async () => {
    const { publisher: p, request, tasks } = setup({ manual: true });
    await p.capture();
    request.mockRejectedValueOnce(new Error('offline'));
    await p.start('A', 'B');
    await flush();
    expect(p.getSnapshot().state).toBe('reconnecting');
    const retryTask = tasks.at(-1)!;
    await p.stop();
    request.mockClear();
    retryTask.callback();
    await flush();
    expect(request).not.toHaveBeenCalled();
    p.dispose();
  });

  it('ignores heartbeat and stats timers from an earlier connection', async () => {
    const { publisher: p, request, tasks } = setup({ manual: true });
    await p.capture();
    await p.start('A', 'B');
    await flush();
    expect(p.getSnapshot().state).toBe('live');
    const stale = [...tasks];
    expect(stale.map((t) => t.ms)).toEqual(expect.arrayContaining([3000, 15000]));

    p.reconnect();
    await flush();
    expect(FakePeer.instances).toHaveLength(2);

    request.mockClear();
    const statsCalls = FakePeer.instances[0].getStats.mock.calls.length;
    for (const task of stale) task.callback();
    await flush();
    expect(request.mock.calls.some(([, path]) => path.endsWith('/heartbeat'))).toBe(false);
    expect(FakePeer.instances[0].getStats.mock.calls.length).toBe(statsCalls);
    p.dispose();
  });
});

describe('publisher statistics edge cases', () => {
  it('treats a slow round trip as a limited connection and reports it', async () => {
    const { publisher: p, start } = setup();
    await start();
    FakePeer.instances[0].getStats.mockResolvedValue(
      new Map<string, never>([
        ['out', { type: 'outbound-rtp', kind: 'video', packetsSent: Date.now(), bytesSent: Date.now() * 1000 } as never],
        ['pair', { type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.5 } as never],
        ['other', { type: 'candidate-pair', state: 'waiting', currentRoundTripTime: 0.9 } as never],
      ]),
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(p.getSnapshot().rttMs).toBe(500);
    expect(p.getSnapshot().signal).not.toBe('good');
    p.dispose();
  });

  it('keeps a fast round trip from limiting the connection', async () => {
    const { publisher: p, start } = setup();
    await start();
    FakePeer.instances[0].getStats.mockResolvedValue(
      new Map<string, never>([
        ['out', { type: 'outbound-rtp', kind: 'video', packetsSent: Date.now(), bytesSent: Date.now() * 1_000_000 } as never],
        ['pair', { type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.05 } as never],
      ]),
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(p.getSnapshot()).toMatchObject({ rttMs: 50, signal: 'good' });
    p.dispose();
  });

  it('stops sampling when a listener stops the broadcast in response to a stats update', async () => {
    const { publisher: p, start } = setup();
    await start();
    FakePeer.instances[0].getStats.mockResolvedValueOnce(
      new Map<string, never>([['out', { type: 'outbound-rtp', kind: 'video', packetsSent: 5, bytesSent: 1, framesPerSecond: 59 } as never]]),
    );
    let stopped = false;
    p.subscribe(() => { if (!stopped && p.getSnapshot().fps === 59) { stopped = true; void p.stop().catch(() => {}); } });
    await vi.advanceTimersByTimeAsync(3000);
    const calls = FakePeer.instances[0].getStats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakePeer.instances[0].getStats.mock.calls.length).toBe(calls);
    p.dispose();
  });
});

describe('publisher connection state handling', () => {
  it('ignores ICE states that are not failures and recovers on an ICE failure', async () => {
    const { publisher: p, start } = setup();
    await start();
    const peer = FakePeer.instances[0];
    peer.ice('checking');
    peer.ice('connected');
    await flush();
    expect(FakePeer.instances).toHaveLength(1);
    peer.ice('failed');
    await flush();
    expect(FakePeer.instances).toHaveLength(2);
    p.dispose();
  });

  it('gives up on other client errors and retries server errors', async () => {
    for (const status of [400, 401, 403, 404, 503]) {
      resetMedia();
      const { publisher: p, request, start } = setup();
      request.mockImplementation(async (_m: string, path: string) => {
        if (path.endsWith('ice-servers')) throw statusError(status);
        return {};
      });
      await start();
      expect(p.getSnapshot()).toMatchObject({ state: 'error', error: 'Could not start the stream. Check access and try again.' });
      p.dispose();
    }
    const { publisher: p, request, start } = setup();
    request.mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith('ice-servers')) throw statusError(500);
      return {};
    });
    await start();
    expect(p.getSnapshot().state).toBe('reconnecting');
    p.dispose();
  });

  it('rethrows a non-conflict failure on republish, and reports the API title for a first-start conflict', async () => {
    const { publisher: p, request, start } = setup();
    await start();
    expect(p.getSnapshot().state).toBe('live');
    request.mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith('ice-servers')) return { iceServers: [] };
      if (path.endsWith('republish')) throw statusError(500);
      return {};
    });
    p.reconnect();
    await flush();
    expect(p.getSnapshot().state).toBe('reconnecting');
    p.dispose();

    resetMedia();
    const second = setup();
    second.request.mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith('ice-servers')) return { iceServers: [] };
      if (path.endsWith('streams')) throw { response: { status: 409, data: { title: 'Angle taken' } } };
      return {};
    });
    await second.start();
    expect(second.publisher.getSnapshot()).toMatchObject({ state: 'error', error: 'Angle taken' });
    second.publisher.dispose();
  });
});
