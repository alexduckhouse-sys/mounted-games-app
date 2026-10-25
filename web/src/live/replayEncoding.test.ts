import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encodeReplay, replayMimeType } from './replayEncoding';
import { asMedia, FakeMediaStream, FakeTrack, flush } from '../test/streamFakes';

const nativeCreate = document.createElement.bind(document);
function setup() {
  const context = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
  const output = asMedia(new FakeMediaStream([new FakeTrack()]));
  const audioMedia = asMedia(new FakeMediaStream([new FakeTrack('audio')]));
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
  const closeAudio = vi.fn(async () => {}); const resumeAudio = vi.fn(async () => {});
  class Audio { createMediaStreamDestination() { return { stream: audioMedia }; } createMediaElementSource() { return sourceNode; } resume = resumeAudio; close = closeAudio; }
  vi.stubGlobal('AudioContext', Audio);
  const videos: HTMLVideoElement[] = [];
  const intervals: ReturnType<typeof setInterval>[] = [];
  const original = nativeCreate;
  let noData = false;
  let width = 1920;
  const play = vi.fn(async function(this: HTMLVideoElement) {
    intervals.push(setInterval(() => { this.currentTime += 0.1; }, 100));
  });
  const load = vi.fn(function(this: HTMLVideoElement) {
    if (!this.src) return;
    if (!noData) queueMicrotask(() => { Object.defineProperty(this, 'readyState', { configurable: true, value: 2 }); this.dispatchEvent(new Event('loadeddata')); });
  });
  vi.spyOn(document, 'createElement').mockImplementation(((name: string) => {
    const element = original(name);
    if (name === 'video') {
      const video = element as HTMLVideoElement;
      Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => width });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
      video.load = load; video.play = play;
      video.pause = vi.fn(() => intervals.splice(0).forEach(clearInterval));
      videos.push(video);
    }
    return element;
  }) as typeof document.createElement);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { configurable: true, value: vi.fn(() => output) });
  class Recorder {
    static isTypeSupported = vi.fn((type: string) => type.includes('webm'));
    static instances: Recorder[] = [];
    mimeType = 'video/webm'; state = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    constructor() { Recorder.instances.push(this); }
    start = vi.fn(() => { this.state = 'recording'; });
    pause = vi.fn(() => { this.state = 'paused'; });
    resume = vi.fn(() => { this.state = 'recording'; });
    stop = vi.fn(() => { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['encoded video']) }); this.onstop?.(); }); });
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(Date.now()), 30));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:${crypto.randomUUID()}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  return { resumeAudio, context, videos, output, audioMedia, closeAudio, sourceNode, play, load, Recorder, noFrames: () => { width = 0; }, stall: () => { noData = true; } };
}
const sources = [{ load: async () => new Blob(['whole valid container']), from: 0.5, to: 1.5 }];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('encodes separate source intervals with canvas transforms, audio and complete cleanup', async () => {
  const state = setup(); const progress = vi.fn(); const transform = vi.fn(() => ({ zoom: 2, panX: 20, panY: 10 }));
  const result = encodeReplay([...sources, ...sources], { onProgress: progress, transform });
  await vi.advanceTimersByTimeAsync(2500); const blob = await result;
  expect(blob.type).toBe('video/webm'); expect(blob.size).toBeGreaterThan(0);
  expect(state.context.drawImage).toHaveBeenCalled(); expect(state.context.scale).toHaveBeenCalledWith(2, 2);
  expect(transform).toHaveBeenCalledWith(expect.any(Number), 1920, 1080);
  expect(state.Recorder.instances[0].resume).toHaveBeenCalledOnce();
  expect(progress).toHaveBeenLastCalledWith(1);
  expect(state.sourceNode.connect).toHaveBeenCalled(); expect(state.closeAudio).toHaveBeenCalled();
  expect(state.output.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it('cancels a running export, stopping its recorder and tracks', async () => {
  const state = setup(); const controller = new AbortController();
  const result = encodeReplay(sources, { signal: controller.signal }); const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await flush(); controller.abort(); await rejected;
  expect(state.closeAudio).toHaveBeenCalled(); expect(state.output.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
});
it('fails clearly when hidden rather than exporting frozen background frames', async () => {
  const state = setup(); const result = encodeReplay(sources); const rejected = expect(result).rejects.toThrow('tab open'); await flush();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); await rejected;
  expect(state.closeAudio).toHaveBeenCalled();
});
it('rejects an unsupported browser or invalid range before recording', async () => {
  setup(); vi.stubGlobal('MediaRecorder', undefined); expect(replayMimeType()).toBeUndefined();
  await expect(encodeReplay(sources)).rejects.toThrow('browser');
  setup(); await expect(encodeReplay([])).rejects.toThrow('some video');
  const controller = new AbortController(); controller.abort(); await expect(encodeReplay(sources, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
it('handles missing canvas and audio capabilities honestly', async () => {
  setup(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null);
  await expect(encodeReplay(sources)).rejects.toThrow('render');
  vi.stubGlobal('AudioContext', undefined); await expect(encodeReplay(sources)).rejects.toThrow('audio');
});
it('cleans up a failed source read and missing video frames', async () => {
  const state = setup(); await expect(encodeReplay([{ ...sources[0], load: async () => { throw new Error('Storage failed'); } }])).rejects.toThrow('Storage failed');
  expect(state.closeAudio).toHaveBeenCalled(); state.noFrames(); await expect(encodeReplay(sources)).rejects.toThrow('no video');
});
it('times out an undecodable container and releases its URL', async () => {
  const state = setup(); state.stall(); const result = encodeReplay(sources); const rejected = expect(result).rejects.toThrow('too long');
  await vi.advanceTimersByTimeAsync(16000); await rejected; expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it('reports decoder and recorder errors without returning a fake video', async () => {
  const state = setup(); state.stall(); const result = encodeReplay(sources); const rejected = expect(result).rejects.toThrow('decoded'); await flush();
  state.videos[0].dispatchEvent(new Event('error')); await rejected;
  const second = setup(); const result2 = encodeReplay(sources); const rejected2 = expect(result2).rejects.toThrow('encode'); await flush();
  second.Recorder.instances[0].onerror?.(); await rejected2;
});
it('rejects an output exceeding the byte limit instead of retaining it in memory', async () => {
  const state = setup(); const result = encodeReplay(sources); const rejected = expect(result).rejects.toThrow('too large'); await flush();
  state.Recorder.instances[0].ondataavailable?.({ data: { size: 129 * 1024 * 1024 } as Blob }); await rejected;
});
it('stops cleanly when playback or canvas drawing fails', async () => {
  const state = setup(); state.play.mockRejectedValueOnce(new Error('Playback blocked')); await expect(encodeReplay(sources)).rejects.toThrow('Playback blocked');
  const second = setup(); const result = encodeReplay(sources); const rejected = expect(result).rejects.toThrow('draw failed'); await flush();
  second.context.drawImage.mockImplementationOnce(() => { throw new Error('draw failed'); }); await vi.advanceTimersByTimeAsync(50); await rejected;
});

it.each(['audio', 'play', 'storage', 'stop'] as const)('cancels while browser %s work remains pending', async (phase) => {
  const state = setup(); const pending = new Promise<void>(() => {});
  if (phase === 'audio') state.resumeAudio.mockReturnValueOnce(pending);
  if (phase === 'play') state.play.mockReturnValueOnce(pending);
  const controller = new AbortController();
  const result = encodeReplay(phase === 'storage' ? [{ ...sources[0], load: () => new Promise<Blob>(() => {}) }] : sources, { signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' }); await flush();
  if (phase === 'stop') {
    state.Recorder.instances[0].stop.mockImplementation(() => { state.Recorder.instances[0].state = 'inactive'; });
    await vi.advanceTimersByTimeAsync(2000);
  }
  controller.abort(); await rejected; expect(state.closeAudio).toHaveBeenCalledOnce();
});
it('times out a browser permission promise that never settles', async () => {
  const state = setup(); state.resumeAudio.mockReturnValueOnce(new Promise(() => {}));
  const result = encodeReplay(sources); const rejected = expect(result).rejects.toThrow('too long');
  await vi.advanceTimersByTimeAsync(15001); await rejected; expect(state.closeAudio).toHaveBeenCalledOnce();
});
it('cancels while waiting for a source decoder and removes its pending event listeners', async () => {
  const state = setup(); state.stall(); const controller = new AbortController();
  const result = encodeReplay(sources, { signal: controller.signal }); const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await flush(); controller.abort(); await rejected; expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
});
it('reports a stalled decoder during playback and releases the recording', async () => {
  const state = setup(); state.play.mockResolvedValue();
  const result = encodeReplay(sources); const rejected = expect(result).rejects.toThrow('stalled');
  await vi.advanceTimersByTimeAsync(17000); await rejected; expect(state.closeAudio).toHaveBeenCalledOnce();
});
it.each(['error', 'ended'] as const)('handles playback %s after recording begins', async (event) => {
  const state = setup(); const result = encodeReplay(sources);
  const check = event === 'error' ? expect(result).rejects.toThrow('Playback failed') : expect(result).resolves.toBeInstanceOf(Blob);
  await flush(); state.videos[0].dispatchEvent(new Event(event)); await check;
});
it.each(['empty', 'error'] as const)('rejects a recorder that finishes with %s output', async (mode) => {
  const state = setup(); const result = encodeReplay(sources);
  const rejected = expect(result).rejects.toThrow(mode === 'empty' ? 'No video' : 'finish'); await flush();
  state.Recorder.instances[0].stop.mockImplementation(() => {
    const recorder = state.Recorder.instances[0]; recorder.state = 'inactive';
    recorder.ondataavailable?.({ data: new Blob([]) });
    if (mode === 'error') recorder.onerror?.(); else recorder.onstop?.();
  });
  await vi.advanceTimersByTimeAsync(2000); await rejected;
});
it('skips empty intervals and does not interrupt an active visible tab', async () => {
  const state = setup(); state.closeAudio.mockRejectedValueOnce(new Error('Already closed'));
  const result = encodeReplay([{ ...sources[0], to: 0.5 }, ...sources]); await flush();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(2000); expect((await result).size).toBeGreaterThan(0);
});
it('honours cancellation that occurs synchronously inside a storage read', async () => {
  setup(); const controller = new AbortController();
  await expect(encodeReplay([{ ...sources[0], load: async () => { controller.abort(); return new Blob(['late']); } }], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
