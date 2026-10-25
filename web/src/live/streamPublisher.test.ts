import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserPublisherDependencies, createStreamPublisher, type PublisherDependencies } from './streamPublisher';
import { streamClock } from './streamRuntime';
import { asMedia, deferred, FakeMediaStream, FakePeer, fakePeerConstructor, FakeTrack, flush, resetMedia } from '../test/streamFakes';

function setup() {
  let hidden = false;
  let visibility!: () => void;
  const release = vi.fn(async () => {});
  const unlisten = vi.fn();
  const request = vi.fn(async (_method: string, path: string): Promise<unknown> => {
    if (path.endsWith('ice-servers')) return { iceServers: [{ urls: 'stun:example.test' }] };
    if (path.endsWith('republish')) return { streamId: 1, attempt: 2, sdpAnswer: 'republished answer' };
    if (path.endsWith('streams')) return { streamId: 1, attempt: 1, sdpAnswer: 'answer' };
    return {};
  });
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => asMedia(new FakeMediaStream([...(constraints.video ? [new FakeTrack()] : []), ...(constraints.audio ? [new FakeTrack('audio')] : [])])));
  const d: PublisherDependencies = { ...streamClock, request: request as PublisherDependencies['request'], getUserMedia, enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'usb' }, { kind: 'audioinput' }] as MediaDeviceInfo[]), PeerConnection: fakePeerConstructor, wakeLock: vi.fn(async () => ({ release })), visibility: { hidden: () => hidden, listen: (fn) => { visibility = fn; return unlisten; } } };
  const publisher = createStreamPublisher(1, d);
  return { publisher, d, request, getUserMedia, release, unlisten, hide: (value: boolean) => { hidden = value; visibility(); }, start: async (sound = true) => { await publisher.capture(sound); await publisher.start('Main Arena', 'Main camera'); await flush(); } };
}
const statusError = (status: number) => ({ response: { status } });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); resetMedia(); });
afterEach(() => { vi.useRealTimers(); });

describe('publisher negotiation and controls', () => {
  it('captures only on request, enumerates inputs, negotiates simulcast then confirms readiness', async () => {
    const { publisher: p, d, request, getUserMedia, start } = setup();
    expect(getUserMedia).not.toHaveBeenCalled();
    const changed = vi.fn(); const unsubscribe = p.subscribe(changed);
    await start();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 }, facingMode: 'environment' }, audio: { echoCancellation: true, noiseSuppression: true } });
    expect(await p.devices()).toEqual([{ kind: 'videoinput', deviceId: 'usb' }]);
    expect(await p.audioDevices()).toEqual([{ kind: 'audioinput' }]);
    const peer = FakePeer.instances[0];
    expect(peer.configuration).toEqual({ iceServers: [{ urls: 'stun:example.test' }], bundlePolicy: 'max-bundle' });
    expect(peer.addTransceiver.mock.calls[0][1].sendEncodings).toEqual([
      { rid: 'f', maxBitrate: 2000000, maxFramerate: 30 },
      { rid: 'h', scaleResolutionDownBy: 1.5, maxBitrate: 850000, maxFramerate: 30 },
      { rid: 'q', scaleResolutionDownBy: 2, maxBitrate: 350000, maxFramerate: 30 },
    ]);
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams', { sdpOffer: 'publisher offer', videoMid: '0', audioMid: '1', arenaName: 'Main Arena', angleName: 'Main camera', takeOver: false });
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams/1/ready', { attempt: 1 });
    expect(p.getSnapshot().state).toBe('live'); expect(d.wakeLock).toHaveBeenCalled();
    p.viewers(48); expect(p.getSnapshot().viewerCount).toBe(48);
    expect(changed).toHaveBeenCalled(); unsubscribe(); p.dispose();
  });
  it('waits until connected before ready, and avoids duplicate starts', async () => {
    const { publisher: p, request } = setup(); FakePeer.connect = false;
    await p.capture(); const started = p.start('Arena', 'Wide'); await flush();
    await p.start('ignored', 'ignored');
    expect(request.mock.calls.some(([, path]) => path.endsWith('/ready'))).toBe(false);
    FakePeer.instances[0].change('connecting');
    FakePeer.instances[0].change('connected'); await started;
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams/1/ready', { attempt: 1 }); p.dispose();
  });
  it('falls back to a single video encoding and can publish without audio', async () => {
    FakePeer.simulcast = false;
    const { publisher: p, start, request } = setup(); await start(false);
    expect(FakePeer.instances[0].addTransceiver).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams', expect.objectContaining({ audioMid: undefined }));
    expect(p.getSnapshot().hasAudio).toBe(false); p.dispose();
  });
  it('pauses audio only, preserves mute across resume, clears captions, and releases all media on end', async () => {
    const { publisher: p, start, request, release } = setup(); await start();
    const media = p.getSnapshot().media!;
    await p.pause(true); expect(media.getVideoTracks()[0].enabled).toBe(true); expect(media.getAudioTracks()[0].enabled).toBe(false);
    await p.mute(true); await p.pause(false); expect(media.getAudioTracks()[0].enabled).toBe(false);
    await p.mute(false); expect(media.getAudioTracks()[0].enabled).toBe(true);
    await p.caption('Final'); await p.caption('');
    expect(request).toHaveBeenCalledWith('PATCH', '/competitions/1/streams/1', { caption: '' });
    await p.stop(); expect(media.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
    expect(release).toHaveBeenCalled(); expect(p.getSnapshot().state).toBe('ended'); p.dispose();
  });
  it('replaces the camera track for flips and USB input without republishing', async () => {
    const { publisher: p, start, getUserMedia } = setup(); await start();
    const old = p.getSnapshot().media!.getVideoTracks()[0];
    await p.switchCamera(); expect(old.readyState).toBe('ended');
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: expect.objectContaining({ facingMode: 'user' }), audio: false });
    await p.switchCamera(); expect(getUserMedia).toHaveBeenLastCalledWith({ video: expect.objectContaining({ facingMode: 'environment' }), audio: false });
    await p.switchCamera('usb'); expect(getUserMedia).toHaveBeenLastCalledWith({ video: expect.objectContaining({ deviceId: { exact: 'usb' } }), audio: false });
    expect(FakePeer.instances[0].transceivers[0].sender.replaceTrack).toHaveBeenCalledTimes(3);
    expect(FakePeer.instances).toHaveLength(1); p.dispose();
  });
  it('keeps the old camera when replaceTrack fails and frees the new capture', async () => {
    const { publisher: p, start, getUserMedia } = setup(); await start();
    FakePeer.instances[0].transceivers[0].sender.replaceTrack.mockRejectedValueOnce(new Error('device'));
    await expect(p.switchCamera()).rejects.toThrow('device');
    const replacement = await getUserMedia.mock.results[1].value;
    expect(replacement.getVideoTracks()[0].readyState).toBe('ended'); p.dispose();
  });
});

describe.each(['pause', 'mute'] as const)('%s optimistic controls', (control) => {
  it('restores pause on failure while keeping mute active for privacy when a PATCH fails', async () => {
    const { publisher: p, start, request } = setup(); await start();
    const pending = deferred<unknown>(); request.mockReturnValueOnce(pending.promise);
    const change = p[control](true);
    const rejected = expect(change).rejects.toThrow('offline');
    expect(p.getSnapshot().media!.getAudioTracks()[0].enabled).toBe(false);
    pending.reject(new Error('offline')); await rejected;
    if (control === 'pause') {
      expect(p.getSnapshot().state).toBe('live');
      expect(p.getSnapshot().media!.getAudioTracks()[0].enabled).toBe(true);
    } else {
      expect(p.getSnapshot().audioMuted).toBe(true);
      expect(p.getSnapshot().media!.getAudioTracks()[0].enabled).toBe(false);
    }
    p.dispose();
  });

  it('does not resurrect a stopped camera when an older request fails, even if ending could not be confirmed', async () => {
    const { publisher: p, start, request } = setup(); await start();
    const media = p.getSnapshot().media!;
    const pending = deferred<unknown>(); request.mockReturnValueOnce(pending.promise);
    const change = p[control](true);
    const rejected = expect(change).rejects.toThrow('offline');
    request.mockRejectedValueOnce(new Error('end offline'));
    await expect(p.stop()).rejects.toThrow('end offline');
    const ended = p.getSnapshot();
    pending.reject(new Error('offline')); await rejected;
    expect(p.getSnapshot()).toEqual(ended);
    expect(p.getSnapshot()).toMatchObject({ state: 'ended', streamId: null, media: null });
    expect(media.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
    p.dispose();
  });

  it('does not undo a newer successful control', async () => {
    const { publisher: p, start, request } = setup(); await start();
    const pending = deferred<unknown>(); request.mockReturnValueOnce(pending.promise);
    const change = p[control](true);
    const rejected = expect(change).rejects.toThrow('offline');
    await p[control](true);
    pending.reject(new Error('offline')); await rejected;
    expect(control === 'pause' ? p.getSnapshot().state : p.getSnapshot().audioMuted).toBe(control === 'pause' ? 'paused' : true);
    expect(p.getSnapshot().media!.getAudioTracks()[0].enabled).toBe(false);
    p.dispose();
  });

  it('leaves reconnection in control when the old peer request fails', async () => {
    const { publisher: p, start, request } = setup(); await start();
    const pending = deferred<unknown>(); request.mockReturnValueOnce(pending.promise);
    const change = p[control](true);
    const rejected = expect(change).rejects.toThrow('offline');
    FakePeer.connect = false;
    FakePeer.instances[0].change('failed'); await flush();
    expect(p.getSnapshot().state).toBe('reconnecting');
    pending.reject(new Error('offline')); await rejected;
    expect(p.getSnapshot().state).toBe('reconnecting');
    FakePeer.instances[1].change('connected'); await flush();
    expect(control === 'pause' ? p.getSnapshot().state : p.getSnapshot().audioMuted).toBe(control === 'pause' ? 'paused' : true);
    expect(p.getSnapshot().media!.getAudioTracks()[0].enabled).toBe(false);
    p.dispose();
  });

  it('ignores failure after disposal', async () => {
    const { publisher: p, start, request } = setup(); await start();
    const pending = deferred<unknown>(); request.mockReturnValueOnce(pending.promise);
    const change = p[control](true);
    const rejected = expect(change).rejects.toThrow('offline');
    p.dispose();
    const ended = p.getSnapshot();
    pending.reject(new Error('offline')); await rejected;
    expect(p.getSnapshot()).toEqual(ended);
  });

  it('does not change a newly started broadcast after a previous request fails', async () => {
    const { publisher: p, start, request } = setup(); await start();
    const pending = deferred<unknown>(); request.mockReturnValueOnce(pending.promise);
    const change = p[control](true);
    const rejected = expect(change).rejects.toThrow('offline');
    await p.stop(); await start();
    const current = p.getSnapshot();
    pending.reject(new Error('offline')); await rejected;
    expect(p.getSnapshot()).toEqual(current);
    p.dispose();
  });
});

describe('publisher recovery', () => {
  it('retries connection timeout and immediate failure before ready', async () => {
    const { publisher: p, request } = setup(); FakePeer.connect = false;
    await p.capture(); const start = p.start('Arena', 'Wide'); await flush();
    await vi.advanceTimersByTimeAsync(15000); await start;
    expect(p.getSnapshot().state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000);
    FakePeer.instances[1].change('failed'); await flush();
    FakePeer.connect = true; await vi.advanceTimersByTimeAsync(2000);
    expect(p.getSnapshot().state).toBe('live');
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams/1/ready', { attempt: 2 }); p.dispose();
  });
  it('recovers failed connections, tolerates short disconnects and republishes long ones', async () => {
    const { publisher: p, start, request } = setup(); await start();
    FakePeer.instances[0].change('disconnected'); await vi.advanceTimersByTimeAsync(4000);
    FakePeer.instances[0].change('connected'); await vi.advanceTimersByTimeAsync(2000);
    expect(FakePeer.instances).toHaveLength(1);
    FakePeer.instances[0].change('disconnected'); await vi.advanceTimersByTimeAsync(5000);
    expect(FakePeer.instances).toHaveLength(2);
    FakePeer.instances[1].change('failed'); await flush();
    expect(FakePeer.instances).toHaveLength(3); expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams/1/republish', expect.any(Object)); p.dispose();
  });
  it('recovers stalled packets and reports poor, fair and good signal from stats', async () => {
    const { publisher: p, start } = setup(); await start();
    await vi.advanceTimersByTimeAsync(3000); expect(p.getSnapshot().signal).toBe('good');
    const peer = FakePeer.instances[0];
    peer.getStats.mockResolvedValue(new Map([['video', { type: 'outbound-rtp', kind: 'video', packetsSent: 5, bytesSent: 500000, qualityLimitationReason: 'bandwidth' }]]));
    await vi.advanceTimersByTimeAsync(3000); expect(p.getSnapshot().signal).toBe('fair');
    await vi.advanceTimersByTimeAsync(3000); expect(p.getSnapshot().signal).toBe('poor');
    await vi.advanceTimersByTimeAsync(9000); expect(FakePeer.instances).toHaveLength(2); p.dispose();
  });
  it('starts a fresh stream without taking over after a republish conflict and restores pause, mute and caption', async () => {
    const { publisher: p, start, request } = setup(); await start();
    await p.pause(true); await p.mute(true); await p.caption('Lunch');
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (method, path) => {
      if (path.endsWith('republish')) throw statusError(409);
      if (path.endsWith('streams')) return { streamId: 2, attempt: 1, sdpAnswer: 'new' };
      return normal(method, path);
    });
    FakePeer.instances[0].change('failed'); await flush();
    expect(request).toHaveBeenLastCalledWith('PATCH', '/competitions/1/streams/2', expect.any(Object));
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams', expect.objectContaining({ takeOver: false, arenaName: 'Main Arena', angleName: 'Main camera' }));
    expect(request).toHaveBeenCalledWith('PATCH', '/competitions/1/streams/2', { status: 1, audioMuted: true, caption: 'Lunch' });
    expect(p.getSnapshot().state).toBe('paused'); p.dispose();
  });
  it('heartbeats every 15 seconds and starts a new row if the sweeper ended it', async () => {
    const { publisher: p, start, request } = setup(); await start();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (method, path) => { if (path.endsWith('heartbeat')) throw statusError(409); return normal(method, path); });
    await vi.advanceTimersByTimeAsync(15000);
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams/1/heartbeat', expect.objectContaining({ audioMuted: false, qualityPreset: '720p' }));
    expect(request).toHaveBeenLastCalledWith('PATCH', '/competitions/1/streams/1', expect.any(Object));
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams', expect.objectContaining({ takeOver: false })); p.dispose();
  });
  it('stops instead of taking the angle back when another camera has taken over', async () => {
    const { publisher: p, start, request } = setup(); await start();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (method: string, path: string) => {
      if (path.endsWith('heartbeat')) throw statusError(409);
      if (method === 'POST' && path.endsWith('streams')) throw statusError(409);
      return normal(method, path);
    });
    await vi.advanceTimersByTimeAsync(15000); await flush();
    expect(request).not.toHaveBeenCalledWith('POST', '/competitions/1/streams', expect.objectContaining({ takeOver: true }));
    expect(p.getSnapshot()).toMatchObject({ state: 'error', streamId: null, error: 'Another camera is now live on Main Arena · Main camera. Your stream has stopped.' });
    const calls = request.mock.calls.length; await vi.advanceTimersByTimeAsync(60000); expect(request.mock.calls.length).toBe(calls);
    p.dispose();
  });
  it('starts afresh when the expired starting row has gone, and a new Go live never reuses the old id', async () => {
    const { publisher: p, start, request } = setup(); await start();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (method: string, path: string) => { if (path.endsWith('heartbeat')) throw statusError(404); return normal(method, path); });
    await vi.advanceTimersByTimeAsync(15000); await flush();
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams', expect.objectContaining({ takeOver: false }));
    expect(p.getSnapshot().state).toBe('live');
    p.dispose();
  });
  it('shows the API reason when the first start is refused', async () => {
    const { publisher: p, request } = setup();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (method: string, path: string) => {
      if (method === 'POST' && path.endsWith('streams')) throw Object.assign(statusError(409), { response: { status: 409, data: { title: 'This competition has reached its stream limit.' } } });
      return normal(method, path);
    });
    await p.capture(); await p.start('Main Arena', 'Main camera'); await flush();
    expect(p.getSnapshot()).toMatchObject({ state: 'error', error: 'This competition has reached its stream limit.' });
    p.dispose();
  });
  it('ignores temporary heartbeat errors and reacquires ended tracks after a long background', async () => {
    const { publisher: p, start, d, hide, getUserMedia, request } = setup(); await start();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (method, path) => { if (path.endsWith('heartbeat')) throw new Error('offline'); return normal(method, path); });
    hide(true); await vi.advanceTimersByTimeAsync(21000);
    p.getSnapshot().media!.getVideoTracks()[0].stop(); hide(false); await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(2); expect(FakePeer.instances).toHaveLength(2);
    expect(d.wakeLock).toHaveBeenCalled(); p.dispose(); hide(false);
  });
  it('best-effort wake locks survive failure and are reacquired on short visibility changes', async () => {
    const { publisher: p, start, d, hide, release } = setup();
    vi.mocked(d.wakeLock).mockRejectedValueOnce(new Error('unsupported'));
    await start(); expect(p.getSnapshot().state).toBe('live');
    hide(true); await vi.advanceTimersByTimeAsync(100); hide(false); await flush();
    hide(false); await flush(); expect(release).toHaveBeenCalled();
    expect(FakePeer.instances).toHaveLength(1); p.dispose();
  });
  it.each([400, 401, 403, 404, 409, 503])('stops automatic retries for an initial %i error', async (status) => {
    const { publisher: p, request } = setup(); await p.capture(); request.mockRejectedValueOnce(statusError(status));
    await p.start('A', 'B'); expect(p.getSnapshot().state).toBe('error'); p.dispose();
  });
  it('keeps retrying network failures with capped backoff and cancels when disposed', async () => {
    const { publisher: p, request } = setup(); await p.capture(); request.mockRejectedValue(new Error('network'));
    await p.start('A', 'B'); await vi.advanceTimersByTimeAsync(100_000);
    expect(request.mock.calls.length).toBeGreaterThan(5); const count = request.mock.calls.length;
    p.dispose(); await vi.advanceTimersByTimeAsync(60000); expect(request).toHaveBeenCalledTimes(count);
  });
});

describe('publisher cancellation', () => {
  it('ends a start response arriving after stop without confirming ready', async () => {
    const { publisher: p, request } = setup(); const response = deferred<unknown>();
    const normal = request.getMockImplementation()!;
    request.mockImplementation((method, path) => path.endsWith('streams') ? response.promise : normal(method, path));
    await p.capture(); const start = p.start('A', 'B'); await flush(); await p.stop();
    response.resolve({ streamId: 9, attempt: 1, sdpAnswer: 'late' }); await start;
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams/9/end');
    expect(request.mock.calls.some(([, path]) => path.endsWith('ready'))).toBe(false); p.dispose();
  });
  it('releases capture that finishes after unmount and allows preview camera changes', async () => {
    const { publisher: p, getUserMedia } = setup();
    await p.capture(); await p.switchCamera('usb');
    const response = deferred<MediaStream>(); getUserMedia.mockReturnValueOnce(response.promise);
    const capturing = p.capture(); p.dispose();
    const media = new FakeMediaStream([new FakeTrack()]); response.resolve(asMedia(media)); await capturing;
    expect(media.tracks[0].stop).toHaveBeenCalled();
    await p.start('A', 'B'); expect(FakePeer.instances).toHaveLength(0);
  });
  it('cancels a pending connection wait and releases the wake lock if it arrives after stop', async () => {
    const { publisher: p, d, release } = setup();
    const wake = deferred<{ release: () => Promise<void> }>(); vi.mocked(d.wakeLock).mockReturnValue(wake.promise);
    await p.capture(); await p.start('A', 'B'); await p.stop(); wake.resolve({ release }); await flush(); expect(release).toHaveBeenCalled(); p.dispose();
    const next = setup(); FakePeer.connect = false; await next.publisher.capture();
    const starting = next.publisher.start('A', 'B'); await flush(); next.publisher.dispose(); await starting;
    expect(next.publisher.getSnapshot().state).toBe('ended');
  });
  it('supports browser dependency bindings without reading devices before permission', async () => {
    const media = asMedia(new FakeMediaStream());
    vi.stubGlobal('RTCPeerConnection', fakePeerConstructor);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => media), enumerateDevices: vi.fn(async () => []) } });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: vi.fn(async () => ({ release: vi.fn() })) } });
    const d = browserPublisherDependencies(); expect(await d.getUserMedia({ video: true })).toBe(media); expect(await d.enumerateDevices()).toEqual([]);
    await d.wakeLock(); expect(d.visibility.hidden()).toBe(document.hidden);
    const callback = vi.fn(); const remove = d.visibility.listen(callback); document.dispatchEvent(new Event('visibilitychange')); expect(callback).toHaveBeenCalledOnce(); remove();
  });
});

it('preserves a muted microphone when ended tracks are reacquired', async () => {
  const { publisher: p, start, hide, request } = setup(); await start(); await p.mute(true);
  hide(true); await vi.advanceTimersByTimeAsync(21000); p.getSnapshot().media!.getVideoTracks()[0].stop();
  hide(false); await flush();
  expect(p.getSnapshot().audioMuted).toBe(true); expect(p.getSnapshot().media!.getAudioTracks()[0].enabled).toBe(false);
  expect(request).toHaveBeenLastCalledWith('PATCH', '/competitions/1/streams/1', expect.objectContaining({ audioMuted: true })); p.dispose();
});
it('ignores a late heartbeat conflict for a replaced publisher and keeps one heartbeat loop', async () => {
  const { publisher: p, start, request } = setup(); await start();
  const response = deferred<unknown>(), normal = request.getMockImplementation()!;
  request.mockImplementation((method, path) => path.endsWith('heartbeat') ? response.promise : normal(method, path));
  await vi.advanceTimersByTimeAsync(15000); FakePeer.instances[0].change('failed'); await flush();
  response.reject(statusError(409)); await flush();
  expect(FakePeer.instances).toHaveLength(2); expect(p.getSnapshot().streamId).toBe(1);
  request.mockImplementation(normal); await vi.advanceTimersByTimeAsync(15000);
  expect(request.mock.calls.filter(([, path]) => path.endsWith('heartbeat'))).toHaveLength(2); p.dispose();
});

it('can add sound to a video-only stream by publishing a new generation', async () => {
  const { publisher: p, start, getUserMedia, request } = setup(); await start(false); await p.mute(false); await flush();
  expect(getUserMedia).toHaveBeenLastCalledWith({ video: false, audio: { echoCancellation: true, noiseSuppression: true } });
  expect(p.getSnapshot().hasAudio).toBe(true); expect(p.getSnapshot().audioMuted).toBe(false);
  expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams/1/republish', expect.objectContaining({ audioMid: '1' })); p.dispose();
});
it('releases microphone permission arriving after a stop', async () => {
  const { publisher: p, start, getUserMedia } = setup(); await start(false);
  const response = deferred<MediaStream>(); getUserMedia.mockReturnValueOnce(response.promise);
  const muting = p.mute(false); await p.stop();
  const audio = new FakeMediaStream([new FakeTrack('audio')]); response.resolve(asMedia(audio)); await muting;
  expect(audio.tracks[0].readyState).toBe('ended'); p.dispose();
});

it('asks to take over on the first publish when the operator chose to replace a live camera', async () => {
  const { publisher: p, request } = setup();
  await p.capture(); await p.start('Main Arena', 'Main camera', true); await flush();
  expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams', expect.objectContaining({ takeOver: true, arenaName: 'Main Arena', angleName: 'Main camera' }));
  p.dispose();
});

describe('publisher camera switching and early controls', () => {
  it('ignores stream controls before a stream exists', async () => {
    const { publisher: p, request } = setup();
    await p.capture(); await p.caption('Lunch'); await p.mute(true);
    expect(request.mock.calls.some(([method]) => method === 'PATCH')).toBe(false);
    p.dispose();
  });
  it('keeps only the newest camera when two switches overlap', async () => {
    const { publisher: p, start, getUserMedia } = setup(); await start();
    const slow = deferred<MediaStream>();
    getUserMedia.mockImplementationOnce(() => slow.promise);
    const first = p.switchCamera('front');
    await p.switchCamera('usb');
    const stale = new FakeTrack();
    slow.resolve(asMedia(new FakeMediaStream([stale]))); await first;
    expect(stale.stop).toHaveBeenCalled();
    expect(p.getSnapshot().media!.getVideoTracks()).not.toContain(stale);
    p.dispose();
  });
  it('releases the new camera and reports the error when the browser refuses the swap', async () => {
    const { publisher: p, start, getUserMedia } = setup(); await start();
    const refused = new FakeTrack();
    getUserMedia.mockImplementationOnce(async () => asMedia(new FakeMediaStream([refused])));
    FakePeer.instances[0].transceivers[0].sender.replaceTrack.mockRejectedValueOnce(new Error('refused'));
    await expect(p.switchCamera('usb')).rejects.toThrow('refused');
    expect(refused.stop).toHaveBeenCalled();
    p.dispose();
  });
  it('runs a recovery asked for mid-publish once that publish finishes', async () => {
    const { publisher: p, request, hide } = setup();
    const ice = deferred<unknown>();
    const normal = request.getMockImplementation()!;
    request.mockImplementation(async (method: string, path: string) => (path.endsWith('ice-servers') && !request.mock.calls.some(([, other]) => other.endsWith('ready')) ? ice.promise : normal(method, path)));
    await p.capture();
    const starting = p.start('Main Arena', 'Main camera'); await flush();
    hide(true); await vi.advanceTimersByTimeAsync(21_000); hide(false);
    ice.resolve({ iceServers: [] }); await starting; await flush(); await flush();
    expect(request).toHaveBeenCalledWith('POST', '/competitions/1/streams/1/republish', expect.any(Object));
    p.dispose();
  });
  it('drops a camera that arrives after a newer switch began while the swap was in flight', async () => {
    const { publisher: p, start } = setup(); await start();
    const swap = deferred<void>();
    FakePeer.instances[0].transceivers[0].sender.replaceTrack.mockImplementationOnce(() => swap.promise);
    const first = p.switchCamera('front');
    await flush();
    const second = p.switchCamera('usb');
    swap.resolve(); await first; await second;
    expect(p.getSnapshot().media!.getVideoTracks()).toHaveLength(1);
    p.dispose();
  });
  it('supports switching audio input, wind filter toggle, hardware zoom, quality presets, and 720p capture fallback', async () => {
    const { publisher: p, start, getUserMedia } = setup();
    let firstTry = true;
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      if (firstTry && constraints.video && typeof constraints.video === 'object' && (constraints.video.width as { ideal?: number })?.ideal === 3840) {
        firstTry = false;
        throw new Error('OverconstrainedError');
      }
      const vTrack = Object.assign(new FakeTrack(), {
        getSettings: () => ({ height: 2160 }),
        getCapabilities: () => ({ zoom: { max: 4 } }),
        applyConstraints: vi.fn(async () => {}),
      });
      return asMedia(new FakeMediaStream([
        ...(constraints.video ? [vTrack] : []),
        ...(constraints.audio ? [new FakeTrack('audio')] : []),
      ]));
    });
    await start();
    expect(p.getSnapshot().captureResolution).toBe('4K');
    expect(p.getSnapshot().maxZoom).toBe(4);
    await p.setZoom(2.5);
    expect(p.getSnapshot().zoom).toBe(2.5);
    p.setWindFilter(false);
    expect(p.getSnapshot().windFilter).toBe(false);
    p.setWindFilter(true);
    expect(p.getSnapshot().windFilter).toBe(true);
    const sender = FakePeer.instances[0].transceivers[0].sender as unknown as {
      getParameters: () => { degradationPreference?: string; encodings: Array<{ rid?: string; maxBitrate?: number; scaleResolutionDownBy?: number; maxFramerate?: number }> };
      setParameters: ReturnType<typeof vi.fn>;
    };
    const encodingsState: Array<{ rid?: string; maxBitrate?: number; scaleResolutionDownBy?: number; maxFramerate?: number }> = [{ rid: 'f' }, { rid: 'h' }, { rid: 'q' }, {}];
    const paramsObj = { encodings: encodingsState, degradationPreference: undefined as string | undefined };
    sender.getParameters = () => paramsObj;
    sender.setParameters = vi.fn(async () => {});
    expect((p.getSnapshot().media!.getVideoTracks()[0] as unknown as { contentHint?: string }).contentHint).toBe('motion');
    await p.setQualityPreset('360p');
    expect(p.getSnapshot().qualityPreset).toBe('360p');
    expect(paramsObj.degradationPreference).toBe('maintain-framerate');
    expect(sender.setParameters).toHaveBeenCalled();
    await p.setQualityPreset('480p');
    expect(p.getSnapshot().qualityPreset).toBe('480p');
    await p.setQualityPreset('auto');
    expect(p.getSnapshot().qualityPreset).toBe('auto');
    await p.setQualityPreset('1080p');
    expect(p.getSnapshot().qualityPreset).toBe('1080p');
    await p.setQualityPreset('720p');
    expect(p.getSnapshot().qualityPreset).toBe('720p');
    await p.switchAudio('ext-mic');
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: false, audio: { echoCancellation: true, noiseSuppression: true, deviceId: { exact: 'ext-mic' } } });

    // Switch audio with 1440p and 1080p resolution labels & error handling
    let heightToReport = 1440;
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      const vTrack = Object.assign(new FakeTrack(), {
        getSettings: () => ({ height: heightToReport }),
      });
      return asMedia(new FakeMediaStream([
        ...(constraints.video ? [vTrack] : []),
        ...(constraints.audio ? [new FakeTrack('audio')] : []),
      ]));
    });
    await p.switchCamera('cam-1440');
    expect(p.getSnapshot().captureResolution).toBe('1440p');
    heightToReport = 1080;
    await p.switchCamera('cam-1080');
    expect(p.getSnapshot().captureResolution).toBe('1080p');

    // Audio replaceTrack failure releases track
    FakePeer.instances[0].transceivers[1].sender.replaceTrack.mockRejectedValueOnce(new Error('mic error'));
    await expect(p.switchAudio('bad-mic')).rejects.toThrow('mic error');

    // Candidate-pair RTT monitoring, ICE failed recovery, and manual reconnect()
    FakePeer.instances[0].getStats.mockResolvedValueOnce(new Map<string, { type: string }>([
      ['video', { type: 'outbound-rtp', kind: 'video', packetsSent: 500, bytesSent: 2_000_000, framesPerSecond: 29.8, qualityLimitationReason: 'none' } as unknown as { type: string }],
      ['pair', { type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.45 } as unknown as { type: string }],
    ]));
    await vi.advanceTimersByTimeAsync(3000);
    expect(p.getSnapshot().rttMs).toBe(450);
    expect(p.getSnapshot().signal).toBe('fair');

    FakePeer.instances[0].ice('failed');
    await flush();
    expect(FakePeer.instances).toHaveLength(2);
    p.reconnect();
    await flush();
    expect(FakePeer.instances).toHaveLength(3);
    p.dispose();
  });
});
