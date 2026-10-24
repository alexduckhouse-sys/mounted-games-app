import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserViewerDependencies, createStreamViewer, streamErrorCode, streamErrors } from './streamViewer';
import { streamClock, type StreamInvoke } from './streamRuntime';
import { deferred, FakeMediaStream, FakePeer, fakePeerConstructor, fakeStreamConstructor, FakeTrack, flush, resetMedia } from '../test/streamFakes';

const offer = { watchId: 'watch-1', sdpOffer: 'offer', generation: 1, iceServers: [{ urls: 'stun:example.test' }] };
function setup() {
  const invoke = vi.fn(async (method: string): Promise<unknown> => method === 'WatchStream' ? offer : undefined);
  const viewer = createStreamViewer(3, 7, { ...streamClock, invoke: invoke as StreamInvoke, PeerConnection: fakePeerConstructor, MediaStream: fakeStreamConstructor });
  return { viewer, invoke, start: async () => { viewer.sync(1, 1); await flush(); } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); resetMedia(); });
afterEach(() => vi.useRealTimers());

it('watches on the shared hub, answers the offer and exposes track media', async () => {
  const { viewer, invoke, start } = setup(); const listener = vi.fn(); const unsubscribe = viewer.subscribe(listener);
  await start(); const peer = FakePeer.instances[0];
  expect(invoke).toHaveBeenCalledWith('WatchStream', 3, 7);
  expect(peer.configuration).toEqual({ iceServers: offer.iceServers, bundlePolicy: 'max-bundle' });
  expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer' });
  expect(invoke).toHaveBeenCalledWith('AnswerStream', 'watch-1', 'viewer answer');
  peer.track(); peer.track(new FakeTrack('audio'));
  expect(viewer.getSnapshot().media!.getTracks()).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(2000); expect(viewer.getSnapshot().state).toBe('playing');
  expect(listener).toHaveBeenCalled(); unsubscribe(); viewer.dispose(); expect(peer.close).toHaveBeenCalled(); expect(invoke).toHaveBeenLastCalledWith('StopWatching', 7);
});
it('re-watches on a new generation, hub readiness and ICE failure, ignoring redundant updates', async () => {
  const { viewer, start } = setup(); await start(); const first = FakePeer.instances[0]; first.track();
  viewer.sync(1, 1); expect(FakePeer.instances).toHaveLength(1);
  viewer.sync(2, 1); await flush(); expect(first.close).toHaveBeenCalled();
  expect(viewer.getSnapshot().state).toBe('reconnecting');
  viewer.sync(2, 2); await flush(); expect(FakePeer.instances).toHaveLength(3);
  FakePeer.instances[2].ice('disconnected'); expect(FakePeer.instances).toHaveLength(3);
  FakePeer.instances[2].ice('failed'); await flush(); expect(FakePeer.instances).toHaveLength(4);
  viewer.dispose(); viewer.sync(3, 3); expect(FakePeer.instances).toHaveLength(4);
});
it('shows recovery at 10 seconds without frames and re-watches at 20', async () => {
  const { viewer, start } = setup(); await start(); const peer = FakePeer.instances[0]; peer.track();
  peer.getStats.mockResolvedValue(new Map());
  await vi.advanceTimersByTimeAsync(10000); expect(viewer.getSnapshot().state).toBe('reconnecting'); expect(FakePeer.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(10000); expect(FakePeer.instances).toHaveLength(2); expect(peer.close).toHaveBeenCalled(); viewer.dispose();
});
it('returns to playing if frames resume before 20 seconds', async () => {
  const { viewer, start } = setup(); await start(); const peer = FakePeer.instances[0];
  peer.getStats.mockResolvedValue(new Map()); await vi.advanceTimersByTimeAsync(10000);
  peer.getStats.mockResolvedValue(new Map([['in', { type: 'inbound-rtp', kind: 'video', framesDecoded: 20 }]]));
  await vi.advanceTimersByTimeAsync(2000); expect(viewer.getSnapshot().state).toBe('playing'); viewer.dispose();
});
it.each(Object.keys(streamErrors) as (keyof typeof streamErrors)[])('parses %s errors and retries only recoverable errors', async (code) => {
  const { viewer, invoke } = setup(); invoke.mockRejectedValue(new Error(`An unexpected error occurred invoking: ${code}: safe detail`));
  viewer.sync(0, 1); await flush(); expect(viewer.getSnapshot().message).toBe(streamErrors[code]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(invoke).toHaveBeenCalledTimes(code === 'STREAM_NOT_FOUND' || code === 'INVALID_REQUEST' ? 1 : 2); viewer.dispose();
});
it('retries unknown errors with capped backoff, then cancels scheduled retries on dispose', async () => {
  const { viewer, invoke } = setup(); invoke.mockRejectedValue(new Error('offline')); viewer.sync(1, 1); await flush();
  expect(viewer.getSnapshot().message).toContain('Trying again');
  await vi.advanceTimersByTimeAsync(100000); expect(invoke.mock.calls.length).toBeGreaterThan(5);
  viewer.dispose(); const count = invoke.mock.calls.length; await vi.advanceTimersByTimeAsync(60000); expect(invoke).toHaveBeenCalledTimes(count);
  expect(streamErrorCode(null)).toBeNull();
});
it('serialises in-flight watches and never answers a stale offer', async () => {
  const { viewer, invoke } = setup(); const response = deferred<unknown>(); invoke.mockReturnValueOnce(response.promise);
  viewer.sync(1, 1); await flush(); viewer.sync(2, 1); viewer.sync(3, 2);
  expect(invoke).toHaveBeenCalledTimes(1);
  response.resolve(offer); await flush();
  expect(invoke.mock.calls.filter(([method]) => method === 'WatchStream')).toHaveLength(2);
  expect(invoke.mock.calls.filter(([method]) => method === 'AnswerStream')).toHaveLength(1); viewer.dispose();
});
it('cleans up a session allocated after disposal and ignores stale tracks', async () => {
  const { viewer, invoke } = setup(); const response = deferred<unknown>(); invoke.mockReturnValueOnce(response.promise);
  viewer.sync(1, 1); viewer.dispose(); response.resolve(offer); await flush();
  expect(FakePeer.instances).toHaveLength(0); expect(invoke).toHaveBeenLastCalledWith('StopWatching', 7);
  const next = setup(); await next.start(); const track = FakePeer.instances[0].ontrack!; next.viewer.dispose(); track({ track: new FakeTrack() }); expect(next.viewer.getSnapshot().media).toBeNull();
});
it('ignores stale failures and stats responses after a re-watch', async () => {
  const { viewer, invoke, start } = setup(); await start();
  const peer = FakePeer.instances[0]; const stats = deferred<Map<string, { type: string }>>(); peer.getStats.mockReturnValueOnce(stats.promise);
  await vi.advanceTimersByTimeAsync(2000); viewer.sync(2, 1); await flush(); stats.resolve(new Map()); await flush();
  expect(FakePeer.instances).toHaveLength(2);
  const response = deferred<unknown>(); invoke.mockReturnValueOnce(response.promise); viewer.sync(3, 1); await flush(); viewer.sync(4, 1); response.reject(new Error('late')); await flush();
  expect(viewer.getSnapshot().state).toBe('connecting'); viewer.dispose();
});
it('tolerates getStats failures and exports browser bindings', async () => {
  const { viewer, start, invoke } = setup(); await start(); FakePeer.instances[0].getStats.mockRejectedValueOnce(new Error('stats'));
  await vi.advanceTimersByTimeAsync(4000); expect(viewer.getSnapshot().state).toBe('playing'); viewer.dispose();
  vi.stubGlobal('RTCPeerConnection', fakePeerConstructor); vi.stubGlobal('MediaStream', FakeMediaStream);
  expect(browserViewerDependencies(invoke as StreamInvoke)).toEqual(expect.objectContaining({ invoke, PeerConnection: fakePeerConstructor, MediaStream: FakeMediaStream }));
});

it('serialises replacement instances and never lets stale cleanup stop their watch', async () => {
  const response = deferred<unknown>();
  const invoke = vi.fn(async (method: string): Promise<unknown> => method === 'WatchStream' ? offer : undefined);
  invoke.mockReturnValueOnce(response.promise);
  const dependencies = { ...streamClock, invoke: invoke as StreamInvoke, PeerConnection: fakePeerConstructor, MediaStream: fakeStreamConstructor };
  const old = createStreamViewer(1, 1, dependencies); old.sync(1, 1); await flush(); old.dispose();
  const next = createStreamViewer(1, 1, dependencies); next.sync(1, 1); await flush();
  expect(invoke).toHaveBeenCalledTimes(1);
  response.resolve(offer); await flush();
  expect(invoke.mock.calls.map(([method]) => method)).toEqual(['WatchStream', 'WatchStream', 'AnswerStream']);
  old.dispose(); expect(invoke).toHaveBeenCalledTimes(3);
  next.dispose(); expect(invoke).toHaveBeenLastCalledWith('StopWatching', 1);
});

it('switches simulcast quality tiers via WatchStreamTier and ignores unchanged quality', async () => {
  const { viewer, invoke, start } = setup();
  invoke.mockImplementation(async (method: string) => (method === 'WatchStream' || method === 'WatchStreamTier' ? offer : undefined));
  viewer.setQuality('f');
  await start();
  viewer.setQuality('h');
  await flush();
  expect(viewer.getSnapshot().preferredRid).toBe('h');
  expect(invoke).toHaveBeenCalledWith('WatchStreamTier', 3, 7, 'h');
  viewer.setQuality('q');
  await flush();
  expect(viewer.getSnapshot().preferredRid).toBe('q');
  expect(invoke).toHaveBeenCalledWith('WatchStreamTier', 3, 7, 'q');
  viewer.dispose();
});

it.each(['remote description', 'local description', 'answer'] as const)('stops a disposed negotiation after %s without continuing the handshake', async (stage) => {
  const pending = deferred<void>();
  class DelayedPeer extends FakePeer {
    constructor(configuration: RTCConfiguration) {
      super(configuration);
      if (stage === 'remote description') this.setRemoteDescription.mockImplementationOnce(() => pending.promise);
      if (stage === 'local description') this.setLocalDescription.mockImplementationOnce(() => pending.promise);
    }
  }
  const invoke = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'WatchStream') return offer;
    if (method === 'AnswerStream' && stage === 'answer') return pending.promise;
  });
  const viewer = createStreamViewer(3, 7, { ...streamClock, invoke: invoke as StreamInvoke, PeerConnection: DelayedPeer as unknown as typeof RTCPeerConnection, MediaStream: fakeStreamConstructor });
  viewer.sync(1, 1); await flush();
  const peer = FakePeer.instances[0];
  viewer.dispose(); pending.resolve(); await flush();
  expect(peer.close).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenLastCalledWith('StopWatching', 7);
  if (stage !== 'answer') expect(invoke.mock.calls.some(([method]) => method === 'AnswerStream')).toBe(false);
  if (stage === 'remote description') expect(peer.createAnswer).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4000);
  expect(peer.getStats).not.toHaveBeenCalled();
});

it('skips a replaced viewer waiting for the shared watch lease and ignores its later refresh', async () => {
  const pending = deferred<unknown>();
  const invoke = vi.fn(async (method: string): Promise<unknown> => method === 'WatchStream' ? offer : undefined);
  invoke.mockReturnValueOnce(pending.promise);
  const deps = { ...streamClock, invoke: invoke as StreamInvoke, PeerConnection: fakePeerConstructor, MediaStream: fakeStreamConstructor };
  const first = createStreamViewer(3, 7, deps); first.sync(1, 1); await flush();
  const replaced = createStreamViewer(3, 7, deps); replaced.sync(1, 1); await flush();
  const latest = createStreamViewer(3, 7, deps); latest.sync(1, 1); await flush();
  pending.resolve(offer); await flush();
  expect(invoke.mock.calls.filter(([method]) => method === 'WatchStream')).toHaveLength(2);
  expect(FakePeer.instances).toHaveLength(1);
  replaced.sync(2, 2); await flush();
  expect(FakePeer.instances).toHaveLength(1);
  first.dispose(); replaced.dispose(); latest.dispose();
});

it('chooses a low bandwidth tier before connecting and ignores audio or missing video frame counts', async () => {
  const { viewer, invoke } = setup();
  invoke.mockImplementation(async (method: string) => method.startsWith('WatchStream') ? offer : undefined);
  viewer.setQuality('q');
  expect(invoke).not.toHaveBeenCalled();
  viewer.sync(1, 1); await flush();
  expect(invoke).toHaveBeenCalledWith('WatchStreamTier', 3, 7, 'q');
  const peer = FakePeer.instances[0];
  peer.getStats.mockResolvedValue(new Map([
    ['audio', { type: 'inbound-rtp', kind: 'audio', framesDecoded: 400 }],
    ['video', { type: 'inbound-rtp', kind: 'video' }],
  ]));
  await vi.advanceTimersByTimeAsync(10000);
  expect(viewer.getSnapshot().state).toBe('reconnecting');
  viewer.dispose();
});

it('does not reschedule stats after a closed peer rejects its pending sample and tolerates failed cleanup', async () => {
  const { viewer, invoke, start } = setup(); await start();
  const pending = deferred<Awaited<ReturnType<FakePeer['getStats']>>>();
  const peer = FakePeer.instances[0]; peer.getStats.mockReturnValueOnce(pending.promise);
  await vi.advanceTimersByTimeAsync(2000);
  invoke.mockRejectedValue(new Error('disconnected during cleanup'));
  viewer.dispose(); pending.reject(new Error('peer closed')); await flush();
  await vi.advanceTimersByTimeAsync(20000);
  expect(peer.getStats).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenLastCalledWith('StopWatching', 7);
});

it('cleans up a lower-tier watch allocated after disposal even when StopWatching fails', async () => {
  const { viewer, invoke } = setup(); const pending = deferred<unknown>();
  invoke.mockImplementation(async (method: string) => {
    if (method === 'WatchStreamTier') return pending.promise;
    if (method === 'StopWatching') throw new Error('hub disconnected');
  });
  viewer.setQuality('h'); viewer.sync(1, 1); await flush();
  expect(invoke).toHaveBeenCalledWith('WatchStreamTier', 3, 7, 'h');
  viewer.dispose(); pending.resolve(offer); await flush();
  expect(FakePeer.instances).toHaveLength(0);
  expect(invoke).toHaveBeenLastCalledWith('StopWatching', 7);
});
