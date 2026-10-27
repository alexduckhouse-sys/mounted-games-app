import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureLowLatencyReceiver, createStreamViewer } from './streamViewer';
import { streamClock, type StreamInvoke } from './streamRuntime';
import { FakePeer, fakePeerConstructor, fakeStreamConstructor, flush, resetMedia } from '../test/streamFakes';

const offer = { watchId: 'watch-1', sdpOffer: 'offer', generation: 1, iceServers: [] };

function setup() {
  const invoke = vi.fn(async (method: string): Promise<unknown> => (method.startsWith('Watch') ? offer : undefined));
  const viewer = createStreamViewer(3, 7, { ...streamClock, invoke: invoke as StreamInvoke, PeerConnection: fakePeerConstructor, MediaStream: fakeStreamConstructor });
  return { viewer, invoke };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); resetMedia(); });
afterEach(() => { vi.useRealTimers(); });

describe('configureLowLatencyReceiver', () => {
  it('only sets the hints a browser supports', () => {
    const neither: Record<string, unknown> = {};
    configureLowLatencyReceiver(neither);
    expect(neither).toEqual({});

    const jitterOnly: Record<string, unknown> = { jitterBufferTarget: null };
    configureLowLatencyReceiver(jitterOnly);
    expect(jitterOnly).toEqual({ jitterBufferTarget: 150 });

    const delayOnly: Record<string, unknown> = { playoutDelayHint: 0 };
    configureLowLatencyReceiver(delayOnly);
    expect(delayOnly).toEqual({ playoutDelayHint: 0.15 });

    expect(() => configureLowLatencyReceiver(null)).not.toThrow();
    expect(() => configureLowLatencyReceiver(undefined)).not.toThrow();
  });

  it('ignores receivers that refuse the hint', () => {
    const stubborn = {};
    Object.defineProperty(stubborn, 'jitterBufferTarget', { get: () => null, set: () => { throw new Error('read only'); }, enumerable: true });
    expect(() => configureLowLatencyReceiver(stubborn)).not.toThrow();
  });
});

describe('viewer stats in audio-only mode', () => {
  it('counts packets from audio reports and tolerates a missing counter', async () => {
    const { viewer } = setup();
    viewer.setAudioOnly(true);
    viewer.sync(1, 1);
    await flush();
    const peer = FakePeer.instances[0];
    peer.getStats.mockResolvedValue(new Map([['a', { type: 'inbound-rtp', kind: 'audio' }], ['v', { type: 'inbound-rtp', kind: 'video', framesDecoded: 99 }]]) as never);
    await vi.advanceTimersByTimeAsync(2000);
    // No packets counted, so playback has not progressed yet.
    expect(viewer.getSnapshot().state).not.toBe('playing');
    peer.getStats.mockResolvedValue(new Map([['a', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 5 }]]) as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(viewer.getSnapshot().state).toBe('playing');
    viewer.dispose();
  });
});

describe('viewer tiers', () => {
  it('connects on a lower tier and keeps going to answer the offer', async () => {
    const { viewer, invoke } = setup();
    viewer.setQuality('q');
    viewer.sync(1, 1);
    await flush();
    expect(invoke).toHaveBeenCalledWith('WatchStreamTier', 3, 7, 'q');
    expect(invoke).toHaveBeenCalledWith('AnswerStream', 'watch-1', 'viewer answer');
    expect(FakePeer.instances).toHaveLength(1);
    viewer.dispose();
  });
});
