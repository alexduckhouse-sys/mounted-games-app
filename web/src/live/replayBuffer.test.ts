import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addSavedReplay, clearSavedReplays, createReplayBuffer, exportTrimmedClip, getSavedReplays, loadPersistedReplays, markReplayAsHighlight, removeSavedReplay, tagSavedReplay, subscribeSavedReplays, updateReplayTrim, type MediaRecorderLike, type SavedReplayClip } from './replayBuffer';
import { encodeReplay } from './replayEncoding';
import { ReplaySegmentStore, type ReplaySegment } from './replaySegments';
import { asMedia, deferred, FakeMediaStream, flush } from '../test/streamFakes';
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
  const handle = createReplayBuffer({ competitionId: 5, arenaName: 'Synthetic Arena', onStatus,
    createRecorder: () => { const recorder = new Recorder(); recorders.push(recorder); return recorder; }, ...extra });
  handles.push(handle);
  const events = new EventTarget();
  const stream = Object.assign(asMedia(new FakeMediaStream()), { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
  return { handle, recorders, onStatus, stream, events };
}
function clip(id = 'clip-1', bytes = 5): SavedReplayClip {
  return { id, competitionId: 5, arenaName: 'Synthetic Arena', label: 'Synthetic race', createdAt: '2026-01-01T12:00:00Z', durationSeconds: 10, mimeType: 'video/webm', blob: new Blob(['x'.repeat(bytes)]), url: `blob:${id}` };
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

describe('complete recorder segments', () => {
  it('retains all chunks of each completed segment and re-encodes requested time ranges', async () => {
    const { handle, recorders, stream } = setup();
    expect(handle.supported).toBe(true); expect(handle.recording).toBe(false);
    expect(handle.start(stream)).toBe(true);
    recorders[0].emit('header-and-frames'); recorders[0].emit('later-frames');
    await vi.advanceTimersByTimeAsync(10_000);
    recorders[1].emit('second-header-and-frames');
    await vi.advanceTimersByTimeAsync(5_000);
    const saved = await handle.saveClip('Finish', 12);
    const sources = vi.mocked(encodeReplay).mock.calls[0][0];
    expect(sources.map((source) => [source.from, source.to])).toEqual([[3, 10], [0, 5]]);
    expect((await sources[0].load()).size).toBe(new Blob(['header-and-frameslater-frames']).size);
    expect((await sources[1].load()).size).toBe(new Blob(['second-header-and-frames']).size);
    expect(saved).toMatchObject({ label: 'Finish', durationSeconds: 12, mimeType: 'video/webm', trimStartSec: 0, trimEndSec: 12 });
    expect(saved!.blob).toBe(await vi.mocked(encodeReplay).mock.results[0].value);
    expect(handle.recording).toBe(true);
  });
  it('returns no video for an unavailable range, rather than substituting unrelated history', async () => {
    const { handle, recorders, stream } = setup(); handle.start(stream);
    recorders[0].emit('recording'); await vi.advanceTimersByTimeAsync(5000);
    expect(await handle.saveClip('Old', 15, 999)).toBeNull();
    expect(encodeReplay).not.toHaveBeenCalled();
  });
  it('cancels encoding when the broadcaster stops and never saves its late result', async () => {
    const pending = deferred<Blob>(); vi.mocked(encodeReplay).mockReturnValueOnce(pending.promise);
    const { handle, recorders, stream } = setup(); handle.start(stream); recorders[0].emit('recording');
    await vi.advanceTimersByTimeAsync(5000);
    const preparing = handle.saveClip('Finish', 5); const rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    await flush(); handle.stop(); pending.resolve(new Blob(['late'])); await rejected;
    expect(getSavedReplays()).toEqual([]);
    expect(vi.mocked(encodeReplay).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('accepts caller cancellation and refuses overlapping encoders', async () => {
    const pending = deferred<Blob>(); vi.mocked(encodeReplay).mockReturnValueOnce(pending.promise);
    const { handle, recorders, stream } = setup(); handle.start(stream); recorders[0].emit('recording'); await vi.advanceTimersByTimeAsync(2000);
    const controller = new AbortController();
    const preparing = handle.saveClip('Finish', { durationSeconds: 2, signal: controller.signal });
    const rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' }); await flush();
    await expect(handle.saveClip()).rejects.toThrow('already');
    controller.abort(); pending.resolve(new Blob(['late'])); await rejected;
  });
  it('restarts after camera track changes without splicing two recordings', async () => {
    const { handle, recorders, stream, events } = setup(); handle.start(stream); recorders[0].emit('first');
    await vi.advanceTimersByTimeAsync(2000); events.dispatchEvent(new Event('removetrack')); events.dispatchEvent(new Event('addtrack')); await flush();
    expect(recorders).toHaveLength(2); expect(recorders[0].stop).toHaveBeenCalledTimes(1);
    recorders[1].emit('second'); await vi.advanceTimersByTimeAsync(2000);
    await handle.saveClip();
    expect(vi.mocked(encodeReplay).mock.calls[0][0]).toHaveLength(2);
  });
  it('does not let a late stopped recorder overwrite a new capture', async () => {
    const { handle, recorders, stream } = setup(); handle.start(stream); recorders[0].emit('old');
    handle.start(stream); await flush();
    expect(recorders).toHaveLength(2); expect(handle.recording).toBe(true);
    recorders[1].emit('new'); await vi.advanceTimersByTimeAsync(2000); await handle.saveClip();
    expect(vi.mocked(encodeReplay).mock.calls[0][0]).toHaveLength(1);
  });
  it('bounds memory and reports shorter available history when disk is unavailable', async () => {
    const { handle, recorders, stream, onStatus } = setup({ memoryLimitBytes: 8 }); handle.start(stream);
    recorders[0].emit('123456'); await vi.advanceTimersByTimeAsync(10_000);
    recorders[1].emit('abcdef'); await vi.advanceTimersByTimeAsync(10_000);
    expect(handle.chunkCount()).toBe(1);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ retainedSeconds: 10, warning: expect.stringMatching(/limit/) }));
  });
  it('rejects invalid times and handles unsupported browsers or recorder errors honestly', async () => {
    const noRecorder = createReplayBuffer({ competitionId: 5, arenaName: 'Synthetic' }); handles.push(noRecorder);
    expect(noRecorder.supported).toBe(false); expect(noRecorder.start(asMedia(new FakeMediaStream()))).toBe(false);
    const { handle, recorders, stream, onStatus } = setup(); handle.start(stream);
    await expect(handle.saveClip('Invalid', 0)).rejects.toThrow('valid');
    await expect(handle.saveClip('Invalid', 15, -2)).rejects.toThrow('valid');
    recorders[0].onerror?.({ error: { name: 'UnknownError' } });
    expect(handle.recording).toBe(false); expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ warning: expect.stringContaining('stopped') }));
  });
  it('passes progress and privacy metadata to saved bookmarks', async () => {
    const { handle, recorders, stream } = setup({ streamId: 9, hasFilmingOptOut: true, resolutionLabel: '4K' }); handle.start(stream);
    recorders[0].emit('video'); await vi.advanceTimersByTimeAsync(2000);
    const saved = await handle.markRaceBookmark('Synthetic finish', 2);
    expect(saved).toMatchObject({ streamId: 9, hasFilmingOptOut: true, resolutionLabel: '4K' });
  });
});

describe('saved replay edits and highlights', () => {
  it('keeps editable originals and creates a separately encoded highlight with a zero-based timeline', async () => {
    const original = clip(); addSavedReplay(original);
    const keys = [{ timeSec: 2, zoom: 2, panX: 10, panY: 0 }];
    const highlight = await exportTrimmedClip(original, 2, 8, keys);
    expect(highlight).toMatchObject({ durationSeconds: 6, trimStartSec: 0, trimEndSec: 6, savedHighlight: true });
    expect(highlight.id).not.toBe(original.id); expect(highlight.blob).not.toBe(original.blob);
    expect(original.blob.size).toBe(5); expect(original.followKeyframes).toEqual(keys);
    expect(getSavedReplays()).toHaveLength(2);
    expect(vi.mocked(encodeReplay).mock.calls[0][0][0]).toMatchObject({ from: 2, to: 8 });
    await expect(exportTrimmedClip(original, 5, 5)).rejects.toThrow('start');
  });
  it('updates trims, highlights and removes stored URLs with notifications', () => {
    const changed = vi.fn(); const unsubscribe = subscribeSavedReplays(changed); const original = clip(); addSavedReplay(original);
    expect(markReplayAsHighlight(original.id, 1, 9)).toMatchObject({ savedHighlight: true });
    expect(updateReplayTrim(original.id, 2, 8)).toMatchObject({ trimStartSec: 2, trimEndSec: 8 });
    expect(updateReplayTrim('missing', 0, 1)).toBeNull(); expect(markReplayAsHighlight('missing')).toBeNull();
    removeSavedReplay(original.id); expect(URL.revokeObjectURL).toHaveBeenCalledWith(original.url);
    expect(changed).toHaveBeenCalled(); unsubscribe();
  });
  it('remembers where a clip came from', () => {
    const changed = vi.fn(); const unsubscribe = subscribeSavedReplays(changed); const original = clip(); addSavedReplay(original);
    expect(tagSavedReplay(original.id, 'race')).toMatchObject({ source: 'race' });
    expect(getSavedReplays()[0].source).toBe('race'); expect(changed).toHaveBeenCalled();
    expect(tagSavedReplay('missing', 'instant')).toBeNull(); unsubscribe();
  });
  it('evicts old saved clips and respects competition-specific clearing', () => {
    for (let i = 0; i < 26; i++) addSavedReplay(clip(String(i)));
    expect(getSavedReplays(5)).toHaveLength(25); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:0');
    addSavedReplay({ ...clip('other'), competitionId: 6 }); clearSavedReplays(5);
    expect(getSavedReplays().map((item) => item.competitionId)).toEqual([6]);
  });
  it('persists follow-cam keyframes, including viewport scale, and restores them after reload', async () => {
    let stored: Record<string, unknown> | undefined;
    const put = vi.fn((value) => { stored = value; });
    const openCursor = vi.fn(() => { const request = { result: null as unknown, onsuccess: null as (() => void) | null };
      request.result = { value: stored, continue: () => { request.result = null; queueMicrotask(() => request.onsuccess?.()); } };
      queueMicrotask(() => request.onsuccess?.()); return request; });
    const db = { close: vi.fn(), transaction: () => ({ objectStore: () => ({ put, openCursor, clear: vi.fn(), delete: vi.fn() }) }) };
    vi.stubGlobal('indexedDB', { open: () => { const request = { result: db, onsuccess: null as (() => void) | null }; queueMicrotask(() => request.onsuccess?.()); return request; } });
    const original = clip(); addSavedReplay(original); await flush();
    const keys = [{ timeSec: 2, zoom: 2, panX: 10, panY: 0, viewportWidth: 640 }];
    updateReplayTrim(original.id, 1, 8, keys); await flush();
    expect(put).toHaveBeenLastCalledWith(expect.objectContaining({ followKeyframes: keys }));
    clearSavedReplays(); const loaded = await loadPersistedReplays(5);
    expect(loaded[0].followKeyframes).toEqual(keys); expect(loaded[0].trimStartSec).toBe(1);
  });
});

it('prunes expired segments and protects an encoding lease until release', async () => {
  const store = new ReplaySegmentStore(1000, 4);
  const old: ReplaySegment = { id: 'old', start: 0, end: 1000, size: 3, blob: new Blob(['old']), pins: 1 };
  await store.add(old); await store.add({ id: 'new', start: 1000, end: 2000, size: 3, blob: new Blob(['new']), pins: 0 });
  expect(store.segments).toContain(old);
  old.pins--; store.prune(4000); expect(store.segments).toEqual([]);
  await expect(store.read({ ...old, blob: undefined })).rejects.toThrow('no longer');
  store.clear();
});


it('does not delete another competition when the 25-clip competition limit is reached', () => {
  for (let i = 0; i < 25; i++) addSavedReplay({ ...clip(`other-${i}`), competitionId: 6 });
  for (let i = 0; i < 26; i++) addSavedReplay(clip(`current-${i}`));
  expect(getSavedReplays(6)).toHaveLength(25); expect(getSavedReplays(5)).toHaveLength(25);
  expect(getSavedReplays(5)[0].id).toBe('current-1');
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});
it('disposes temporary recordings and ignores the final recorder data after leaving the page', async () => {
  const { handle, recorders, stream } = setup(); handle.start(stream); recorders[0].emit('video');
  await vi.advanceTimersByTimeAsync(10000); expect(handle.chunkCount()).toBe(1);
  handle.dispose(); await flush(); expect(handle.recording).toBe(false); expect(handle.chunkCount()).toBe(0);
});

it('reports saved-clip quota failure and clears the warning after a durable retry', async () => {
  let fails = true;
  const close = vi.fn();
  vi.stubGlobal('indexedDB', { open: () => {
    const request = { onsuccess: null as (() => void) | null, result: { close, transaction: () => {
      const tx = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, error: new Error('Quota exceeded'), objectStore: () => ({ put: () => queueMicrotask(() => { if (fails) tx.onerror?.(); else tx.oncomplete?.(); }), clear: vi.fn() }) }; return tx;
    } } }; queueMicrotask(() => request.onsuccess?.()); return request;
  } });
  const original = clip(); addSavedReplay(original); await flush();
  expect(original.storageWarning).toMatch(/Download/); expect(close).toHaveBeenCalled();
  fails = false; markReplayAsHighlight(original.id); await flush(); expect(original.storageWarning).toBeUndefined();
});
it('bounds an unexpectedly oversized native recorder segment and ignores stale or empty events', async () => {
  const { handle, recorders, stream, onStatus } = setup(); handle.start(stream);
  recorders[0].ondataavailable?.({ data: new Blob([]) });
  recorders[0].ondataavailable?.({ data: { size: 33 * 1024 * 1024 } as Blob }); await flush();
  expect(handle.recording).toBe(false); expect(handle.chunkCount()).toBe(0);
  expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ warning: expect.stringMatching(/memory/) }));
  handle.start(stream); recorders[0].emit('stale event'); expect(handle.chunkCount()).toBe(0);
});
it('restarts recording after a native InvalidModificationError from changed tracks', async () => {
  const { handle, recorders, stream, onStatus } = setup(); handle.start(stream);
  recorders[0].onerror?.({ error: { name: 'InvalidModificationError' } }); recorders[0].stop(); await flush();
  expect(handle.recording).toBe(true); expect(recorders).toHaveLength(2);
  expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ warning: expect.stringMatching(/restarting/) }));
});
it('honours an already-cancelled save before invoking the encoder', async () => {
  const { handle, recorders, stream } = setup(); handle.start(stream); recorders[0].emit('video'); await vi.advanceTimersByTimeAsync(1000);
  const controller = new AbortController(); controller.abort();
  await expect(handle.saveClip('Cancelled', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(encodeReplay).not.toHaveBeenCalled();
});
it('uses the native recorder with bounded bitrate and releases custom clip URLs safely', async () => {
  const recorders: Recorder[] = []; const options: unknown[] = [];
  class NativeRecorder extends Recorder { static isTypeSupported = () => true; constructor(_stream: MediaStream, settings: unknown) { super(); recorders.push(this); options.push(settings); } }
  vi.stubGlobal('MediaRecorder', NativeRecorder);
  const revoke = vi.fn(() => { throw new Error('Already revoked'); });
  const handle = createReplayBuffer({ competitionId: 5, arenaName: 'Synthetic', createObjectUrl: () => 'blob:custom', revokeObjectUrl: revoke }); handles.push(handle);
  handle.start(asMedia(new FakeMediaStream())); recorders[0].emit('video'); await vi.advanceTimersByTimeAsync(1000);
  const saved = await handle.saveClip(); expect(options[0]).toEqual(expect.objectContaining({ videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 }));
  removeSavedReplay(saved!.id); expect(revoke).toHaveBeenCalledWith('blob:custom'); expect(getSavedReplays()).toEqual([]);
  expect(() => removeSavedReplay('missing')).not.toThrow();
});
it('never retains a highlight after cancellation while its encoder finishes', async () => {
  const controller = new AbortController(); const original = clip();
  vi.mocked(encodeReplay).mockImplementationOnce(async (sources) => { expect(await sources[0].load()).toBe(original.blob); controller.abort(); return new Blob(['late']); });
  await expect(exportTrimmedClip(original, 0, 5, undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(getSavedReplays()).toEqual([]);
});
it('persists an explicitly saved follow path and survives URL-revocation errors', () => {
  const original = clip(); addSavedReplay(original); const path = [{ timeSec: 0, zoom: 2, panX: 3, panY: 4 }];
  expect(markReplayAsHighlight(original.id, undefined, undefined, path)?.followKeyframes).toEqual(path);
  vi.mocked(URL.revokeObjectURL).mockImplementationOnce(() => { throw new Error('Already revoked'); });
  expect(() => removeSavedReplay(original.id)).not.toThrow();
});

it('cancels immediately while a final segment is still waiting for device storage', async () => {
  const waiting = deferred<void>(); const add = vi.spyOn(ReplaySegmentStore.prototype, 'add').mockReturnValueOnce(waiting.promise);
  const { handle, recorders, stream } = setup(); handle.start(stream); recorders[0].emit('video'); await vi.advanceTimersByTimeAsync(1000);
  const controller = new AbortController(); const saving = handle.saveClip('Finish', { signal: controller.signal });
  const rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' }); await flush(); controller.abort(); await rejected;
  expect(encodeReplay).not.toHaveBeenCalled(); waiting.resolve(); await flush(); add.mockRestore();
});

function storedClipsDatabase(initial: Array<Partial<SavedReplayClip>> = []) {
  const items = new Map(initial.map((item) => [item.id, item]));
  const state = { existingStore: false, openError: false, blocked: false, throwOpen: false, throwTransaction: false, cursorError: false, abortWrite: false };
  const deleted = vi.fn((id: string) => items.delete(id)); const close = vi.fn(); const createObjectStore = vi.fn();
  const db = { close, createObjectStore, objectStoreNames: { contains: () => state.existingStore }, transaction: () => {
    if (state.throwTransaction) throw new Error('Storage unavailable');
    const tx = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null, error: new Error('Write aborted'), objectStore: () => ({
      put: (item: SavedReplayClip) => queueMicrotask(() => { if (state.abortWrite) tx.onabort?.(); else { items.set(item.id, item); tx.oncomplete?.(); } }),
      delete: deleted, clear: () => items.clear(), getAll: () => {
        const request = { result: [...items.values()], onsuccess: null as (() => void) | null }; queueMicrotask(() => request.onsuccess?.()); return request;
      },
      openCursor: () => {
        const entries = [...items.values()]; let index = 0;
        const request = { result: null as unknown, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
        const next = () => { const value = entries[index++]; request.result = value ? { value, continue: next } : null; queueMicrotask(() => state.cursorError ? request.onerror?.() : request.onsuccess?.()); };
        next(); return request;
      },
    }) }; return tx;
  } };
  vi.stubGlobal('indexedDB', { open: () => {
    if (state.throwOpen) throw new Error('Storage blocked');
    const request = { result: db, onsuccess: null as (() => void) | null, onupgradeneeded: null as (() => void) | null, onerror: null as (() => void) | null, onblocked: null as (() => void) | null };
    queueMicrotask(() => { if (state.openError) request.onerror?.(); else if (state.blocked) request.onblocked?.(); else { request.onupgradeneeded?.(); request.onsuccess?.(); } }); return request;
  } });
  return { items, state, deleted, close, createObjectStore };
}
it('restores valid clips with default trims, skips unrelated/broken records and reuses loaded URLs', async () => {
  const existing = clip('existing'); addSavedReplay(existing); await flush();
  const db = storedClipsDatabase([existing, clip('new'), { ...clip('other'), competitionId: 8 }, { ...clip('broken'), blob: undefined }]);
  const createUrl = vi.fn(() => 'blob:restored');
  const restored = await loadPersistedReplays(5, createUrl);
  expect(restored.map((c) => c.id)).toEqual(['existing', 'new']); expect(restored[0]).toBe(existing);
  expect(restored[1]).toMatchObject({ trimStartSec: 0, trimEndSec: 10, savedHighlight: false });
  expect(createUrl).toHaveBeenCalledOnce(); expect(db.createObjectStore).toHaveBeenCalled();
  db.state.existingStore = true;
  const all = await loadPersistedReplays(undefined, createUrl); expect(all.map((c) => c.id)).toEqual(['existing', 'new', 'other']);
  expect(db.close).toHaveBeenCalledTimes(2);
});
it.each(['openError', 'blocked', 'throwOpen', 'throwTransaction', 'cursorError'] as const)('fails closed when saved clip storage cannot be read: %s', async (mode) => {
  const db = storedClipsDatabase([clip()]); db.state[mode] = true;
  expect(await loadPersistedReplays()).toEqual([]);
});
it('deletes only the chosen competition from durable saved clips', async () => {
  const db = storedClipsDatabase([clip('chosen'), { ...clip('other'), competitionId: 6 }]);
  clearSavedReplays(5); await flush(); expect(db.deleted).toHaveBeenCalledWith('chosen'); expect(db.items.has('other')).toBe(true);
  addSavedReplay(clip('removed')); await flush(); removeSavedReplay('removed'); await flush(); expect(db.deleted).toHaveBeenCalledWith('removed');
});
it('handles aborted writes and unavailable delete/clear transactions without losing current replay access', async () => {
  const db = storedClipsDatabase(); db.state.abortWrite = true;
  const original = clip(); addSavedReplay(original); await flush(); expect(original.storageWarning).toMatch(/Download/);
  db.state.throwTransaction = true; removeSavedReplay(original.id); clearSavedReplays(5); await flush();
  expect(getSavedReplays()).toEqual([]);
});
it('applies the saved-clip memory byte limit across competitions and on reload', async () => {
  const large = clip('large'); Object.defineProperty(large.blob, 'size', { value: 128 * 1024 * 1024 });
  addSavedReplay(large); const next = { ...clip('next'), competitionId: 6 }; addSavedReplay(next);
  expect(getSavedReplays().map((c) => c.id)).toEqual(['next']);
  const oversized = clip('oversized'); Object.defineProperty(oversized.blob, 'size', { value: 129 * 1024 * 1024 });
  storedClipsDatabase([oversized]); expect(await loadPersistedReplays()).toEqual([]);
});
