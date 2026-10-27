import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSavedReplays, createReplayBuffer, type MediaRecorderLike } from './replayBuffer';
import { encodeReplay } from './replayEncoding';
import { asMedia, FakeMediaStream, flush } from '../test/streamFakes';

vi.mock('./replayEncoding', async (original) => ({ ...await original<typeof import('./replayEncoding')>(), encodeReplay: vi.fn() }));

class Recorder implements MediaRecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'video/webm';
  ondataavailable: MediaRecorderLike['ondataavailable'] = null;
  onerror: MediaRecorderLike['onerror'] = null;
  onstop: MediaRecorderLike['onstop'] = null;
  start = vi.fn(() => { this.state = 'recording'; });
  stop = vi.fn(() => { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); });
  emit(text: string) { this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) }); }
}

const handles: ReturnType<typeof createReplayBuffer>[] = [];
function setup(extra: Partial<Parameters<typeof createReplayBuffer>[0]> = {}) {
  const recorders: Recorder[] = [];
  const onStatus = vi.fn();
  const handle = createReplayBuffer({
    competitionId: 5,
    arenaName: 'Synthetic Arena',
    onStatus,
    createRecorder: () => { const recorder = new Recorder(); recorders.push(recorder); return recorder; },
    ...extra,
  });
  handles.push(handle);
  const stream = asMedia(new FakeMediaStream());
  return { handle, recorders, onStatus, stream };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('MediaRecorder', undefined);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:${crypto.randomUUID()}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.mocked(encodeReplay).mockResolvedValue(new Blob(['encoded'], { type: 'video/webm' }));
  clearSavedReplays();
});
afterEach(async () => { handles.splice(0).forEach((h) => h.stop()); await flush(); clearSavedReplays(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('replay buffer starting and stopping', () => {
  it('refuses to start without a stream', () => {
    const { handle } = setup();
    expect(handle.start(null as unknown as MediaStream)).toBe(false);
    expect(handle.recording).toBe(false);
    expect(handle.chunkCount()).toBe(0);
  });
});

describe('replay buffer recorder edge cases', () => {
  it('lets an already-stopped recorder run out its segment timer without stopping it again', async () => {
    const { handle, recorders, stream } = setup();
    handle.start(stream);
    recorders[0].state = 'inactive';
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recorders[0].stop).not.toHaveBeenCalled();
  });

  it('does not stop a recorder twice when an oversized segment arrives after it already stopped', async () => {
    const { handle, recorders, stream, onStatus } = setup();
    handle.start(stream);
    recorders[0].state = 'inactive';
    recorders[0].ondataavailable?.({ data: new Blob([new Uint8Array(33 * 1024 * 1024)]) });
    expect(recorders[0].stop).not.toHaveBeenCalled();
    expect(handle.recording).toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ warning: 'Recording used too much memory. Replay recording has stopped.' }));
  });

  it('labels a segment as webm when the recorder and browser report no type', async () => {
    const { handle, recorders, stream } = setup();
    handle.start(stream);
    recorders[0].mimeType = '';
    recorders[0].ondataavailable?.({ data: new Blob(['frames']) });
    await vi.advanceTimersByTimeAsync(10_000);
    await handle.saveClip('Type check', 5);
    const sources = vi.mocked(encodeReplay).mock.calls[0][0];
    expect((await sources[0].load()).type).toBe('video/webm');
  });

  it('keeps the recorder type when it reports one and the browser does not', async () => {
    const { handle, recorders, stream } = setup();
    handle.start(stream);
    recorders[0].mimeType = 'video/mp4';
    recorders[0].ondataavailable?.({ data: new Blob(['frames']) });
    await vi.advanceTimersByTimeAsync(10_000);
    await handle.saveClip('Type check', 5);
    const sources = vi.mocked(encodeReplay).mock.calls[0][0];
    expect((await sources[0].load()).type).toBe('video/mp4');
  });
});

describe('replay buffer saving after recording stops', () => {
  it('can still save the history it holds, without a live recorder to finish', async () => {
    const { handle, recorders, stream } = setup();
    handle.start(stream);
    recorders[0].emit('frames');
    await vi.advanceTimersByTimeAsync(4000);
    handle.stop();
    await flush();
    expect(handle.recording).toBe(false);
    const clip = await handle.saveClip('After stop', 10);
    expect(clip).toMatchObject({ label: 'After stop' });
    expect(recorders[0].stop).toHaveBeenCalledTimes(1);
  });

  it('abandons a save cancelled in the instant its recorder finishes', async () => {
    const { handle, recorders, stream } = setup();
    handle.start(stream);
    recorders[0].emit('frames');
    await vi.advanceTimersByTimeAsync(4000);
    handle.stop();
    await flush();

    const controller = new AbortController();
    const saving = handle.saveClip('Race', { durationSeconds: 10, signal: controller.signal });
    const rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' });
    void Promise.resolve().then(() => controller.abort());
    await rejected;
    expect(encodeReplay).not.toHaveBeenCalled();
    // The buffer is usable again afterwards.
    await expect(handle.saveClip('Retry', 10)).resolves.toMatchObject({ label: 'Retry' });
  });
});
