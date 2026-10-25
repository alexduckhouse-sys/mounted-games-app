import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSavedReplay,
  clearSavedReplays,
  createReplayBuffer,
  exportTrimmedClip,
  getSavedReplays,
  loadPersistedReplays,
  markReplayAsHighlight,
  removeSavedReplay,
  subscribeSavedReplays,
  updateReplayTrim,
  type FollowKeyframe,
  type MediaRecorderLike,
  type SavedReplayClip,
} from './replayBuffer';
import { FakeMediaStream, asMedia } from '../test/streamFakes';

class MockRecorder implements MediaRecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'video/webm;codecs=vp8,opus';
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  timeslice?: number;

  start = vi.fn((timeslice?: number) => {
    this.state = 'recording';
    this.timeslice = timeslice;
  });

  stop = vi.fn(() => {
    this.state = 'inactive';
  });

  emitChunk(data: Blob) {
    this.ondataavailable?.({ data });
  }

  emitError(err: unknown = new Error('Recorder error')) {
    this.onerror?.(err);
  }
}

describe('replayBuffer', () => {
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    clearSavedReplays();
  });

  afterEach(() => {
    clearSavedReplays();
    vi.restoreAllMocks();
  });

  const fakeUrlGenerator = (blob: Blob) => {
    const url = `blob:test/${Math.random().toString(36).slice(2)}_${blob.size}`;
    createdUrls.push(url);
    return url;
  };

  const fakeUrlRevoker = (url: string) => {
    revokedUrls.push(url);
  };

  it('records chunks, preserves initChunk after rolling buffer pruning, and saves a clip', () => {
    let mockRecorder: MockRecorder | null = null;
    let fakeNow = 1000;

    const buffer = createReplayBuffer({
      competitionId: 10,
      streamId: 5,
      arenaName: 'Arena A',
      windowSeconds: 5,
      timesliceMs: 1000,
      now: () => fakeNow,
      createRecorder: () => {
        mockRecorder = new MockRecorder();
        return mockRecorder;
      },
      createObjectUrl: fakeUrlGenerator,
      revokeObjectUrl: fakeUrlRevoker,
    });

    expect(buffer.supported).toBe(true);
    expect(buffer.recording).toBe(false);
    expect(buffer.chunkCount()).toBe(0);

    // Saving before any chunks gives null
    expect(buffer.saveClip()).toBeNull();

    const stream = asMedia(new FakeMediaStream());
    expect(buffer.start(stream)).toBe(true);
    expect(buffer.recording).toBe(true);
    expect(mockRecorder!.start).toHaveBeenCalledWith(1000);

    // Initial non-empty chunk (initChunk)
    const initBlob = new Blob(['init-header'], { type: 'video/webm' });
    mockRecorder!.emitChunk(initBlob);
    expect(buffer.chunkCount()).toBe(1);

    // Empty chunk is ignored
    mockRecorder!.emitChunk(new Blob([], { type: 'video/webm' }));
    expect(buffer.chunkCount()).toBe(1);

    // Save clip early: initChunk is still chunk 0, so it is not duplicated
    const earlyClip = buffer.saveClip('Early Highlight');
    expect(earlyClip).not.toBeNull();
    expect(earlyClip!.label).toBe('Early Highlight');
    expect(earlyClip!.competitionId).toBe(10);
    expect(earlyClip!.streamId).toBe(5);
    expect(earlyClip!.arenaName).toBe('Arena A');
    expect(earlyClip!.durationSeconds).toBe(1);
    expect(earlyClip!.savedHighlight).toBe(false);

    // Advance time past 5 seconds (window size): emit 6 more chunks
    for (let i = 1; i <= 6; i++) {
      fakeNow += 1000;
      mockRecorder!.emitChunk(new Blob([`frame-${i}`], { type: 'video/webm' }));
    }

    // Since window is 5s, the rolling buffer contains the latest chunks,
    // and initChunk was pruned from recent chunks.
    expect(buffer.chunkCount()).toBeLessThanOrEqual(6);

    // Saving clip after pruning: initChunk should be preserved and prepended
    const rolledClip = buffer.saveClip();
    expect(rolledClip).not.toBeNull();
    expect(rolledClip!.label).toBe('Arena A Replay');
    expect(rolledClip!.blob.size).toBeGreaterThan(initBlob.size);

    // Stopping the buffer
    buffer.stop();
    expect(buffer.recording).toBe(false);
    expect(mockRecorder!.stop).toHaveBeenCalled();

    // Calling stop again is a no-op
    buffer.stop();
  });

  it('supports slicing by requested duration (15s, 30s, 60s full race)', () => {
    let mockRecorder: MockRecorder | null = null;
    let fakeNow = 1000;

    const buffer = createReplayBuffer({
      competitionId: 10,
      arenaName: 'Main Arena',
      windowSeconds: 60,
      timesliceMs: 1000,
      now: () => fakeNow,
      createRecorder: () => {
        mockRecorder = new MockRecorder();
        return mockRecorder;
      },
      createObjectUrl: fakeUrlGenerator,
      revokeObjectUrl: fakeUrlRevoker,
    });

    buffer.start(asMedia(new FakeMediaStream()));
    mockRecorder!.emitChunk(new Blob(['init']));

    // Emit 40 chunks (40 seconds of recording)
    for (let i = 1; i <= 40; i++) {
      fakeNow += 1000;
      mockRecorder!.emitChunk(new Blob([`data-${i}`]));
    }

    // Save a 15s clip
    const clip15 = buffer.saveClip('15s Clip', 15);
    expect(clip15).not.toBeNull();
    expect(clip15!.durationSeconds).toBeLessThanOrEqual(16);
    expect(clip15!.durationSeconds).toBeGreaterThanOrEqual(14);

    // Save a 30s clip
    const clip30 = buffer.saveClip('30s Clip', 30);
    expect(clip30).not.toBeNull();
    expect(clip30!.durationSeconds).toBeLessThanOrEqual(31);
    expect(clip30!.durationSeconds).toBeGreaterThanOrEqual(29);

    // Save with offsetAgoSeconds (e.g. 10s ago)
    const clipOffset = buffer.saveClip('Race 1 Review', 15, 10);
    expect(clipOffset).not.toBeNull();
    expect(clipOffset!.label).toBe('Race 1 Review');

    // Auto-bookmark race
    const bookmark = buffer.markRaceBookmark('Heat 1 Race 4', 20);
    expect(bookmark).not.toBeNull();
    expect(bookmark!.label).toBe('Heat 1 Race 4');

    // Save with options object containing offsetAgoSeconds
    const clipOpt = buffer.saveClip('Custom Opt Clip', {
      durationSeconds: 20,
      offsetAgoSeconds: 5,
      hasFilmingOptOut: true,
      resolutionLabel: '4K',
    });
    expect(clipOpt).not.toBeNull();
    expect(clipOpt!.hasFilmingOptOut).toBe(true);
    expect(clipOpt!.resolutionLabel).toBe('4K');
    expect(clipOpt!.durationSeconds).toBeLessThanOrEqual(21);

    // Save with huge offset resulting in empty sliced array (falls back to chunks)
    mockRecorder!.mimeType = '';
    const clipFallback = buffer.saveClip('Fallback Clip', 15, 99999);
    expect(clipFallback).not.toBeNull();
    expect(clipFallback!.mimeType).toBe('video/webm');
  });

  it('uses default 30-min window and default createObjectUrl, and handles inactive stop', () => {
    let mockRecorder: MockRecorder | null = null;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:default-url');

    const buffer = createReplayBuffer({
      competitionId: 1,
      arenaName: 'Main Arena',
      createRecorder: () => {
        mockRecorder = new MockRecorder();
        return mockRecorder;
      },
    });

    buffer.start(asMedia(new FakeMediaStream()));
    mockRecorder!.emitChunk(new Blob(['init-data']));
    const clip = buffer.saveClip('Default Window Clip');
    expect(clip).not.toBeNull();
    expect(clip!.url).toBe('blob:default-url');

    // Set recorder state to inactive manually then call stop
    mockRecorder!.state = 'inactive';
    buffer.stop();
  });

  it('stops and resets when start is called while already recording', () => {
    let recorderCount = 0;
    const recorders: MockRecorder[] = [];

    const buffer = createReplayBuffer({
      competitionId: 1,
      arenaName: 'Main',
      createRecorder: () => {
        recorderCount++;
        const rec = new MockRecorder();
        recorders.push(rec);
        return rec;
      },
      createObjectUrl: fakeUrlGenerator,
      revokeObjectUrl: fakeUrlRevoker,
    });

    const stream = asMedia(new FakeMediaStream());
    buffer.start(stream);
    expect(recorders[0].start).toHaveBeenCalled();

    recorders[0].emitChunk(new Blob(['data-1']));
    expect(buffer.chunkCount()).toBe(1);

    // Start again with another stream
    buffer.start(stream);
    expect(recorders[0].stop).toHaveBeenCalled();
    expect(recorders[1].start).toHaveBeenCalled();
    expect(buffer.chunkCount()).toBe(0);
    expect(recorderCount).toBe(2);
  });

  it('handles recorder errors by stopping recording', () => {
    let mockRecorder: MockRecorder | null = null;
    const buffer = createReplayBuffer({
      competitionId: 1,
      arenaName: 'Main',
      createRecorder: () => {
        mockRecorder = new MockRecorder();
        return mockRecorder;
      },
    });

    const stream = asMedia(new FakeMediaStream());
    buffer.start(stream);
    expect(buffer.recording).toBe(true);

    mockRecorder!.emitError(new Error('Device disconnected'));
    expect(buffer.recording).toBe(false);
  });

  it('handles invalid stream or recorder startup errors gracefully', () => {
    const buffer = createReplayBuffer({
      competitionId: 1,
      arenaName: 'Main',
      createRecorder: () => {
        const rec = new MockRecorder();
        rec.start = vi.fn(() => {
          throw new Error('Not allowed to start');
        });
        return rec;
      },
    });

    // Null stream returns false
    expect(buffer.start(null as unknown as MediaStream)).toBe(false);

    const stream = asMedia(new FakeMediaStream());
    expect(buffer.start(stream)).toBe(false);
    expect(buffer.supported).toBe(false);
    expect(buffer.recording).toBe(false);
  });

  it('handles recorder constructor throwing in createRecorder', () => {
    const buffer = createReplayBuffer({
      competitionId: 1,
      arenaName: 'Main',
      createRecorder: () => {
        throw new Error('Constructor failure');
      },
    });

    const stream = asMedia(new FakeMediaStream());
    expect(buffer.start(stream)).toBe(false);
    expect(buffer.supported).toBe(false);
  });

  it('works with browser MediaRecorder global when createRecorder is omitted', () => {
    const mockStart = vi.fn();
    const mockStop = vi.fn();

    class FakeGlobalMediaRecorder {
      static isTypeSupported = vi.fn((type: string) => type.includes('webm'));
      static lastInstance: FakeGlobalMediaRecorder | null = null;
      state = 'inactive';
      mimeType = 'video/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      start = mockStart.mockImplementation(() => {
        this.state = 'recording';
      });
      stop = mockStop.mockImplementation(() => {
        this.state = 'inactive';
      });
      constructor() {
        FakeGlobalMediaRecorder.lastInstance = this;
      }
    }

    vi.stubGlobal('MediaRecorder', FakeGlobalMediaRecorder);

    const buffer = createReplayBuffer({
      competitionId: 7,
      arenaName: 'Grass Arena',
      createObjectUrl: fakeUrlGenerator,
      revokeObjectUrl: fakeUrlRevoker,
    });

    expect(buffer.supported).toBe(true);
    const stream = asMedia(new FakeMediaStream());
    expect(buffer.start(stream)).toBe(true);
    expect(mockStart).toHaveBeenCalled();

    FakeGlobalMediaRecorder.lastInstance?.ondataavailable?.({ data: new Blob(['chunk1']) });
    const clip = buffer.saveClip('Global MediaRecorder Clip', {
      hasFilmingOptOut: true,
      resolutionLabel: '1080p',
    });

    expect(clip).not.toBeNull();
    expect(clip!.hasFilmingOptOut).toBe(true);
    expect(clip!.resolutionLabel).toBe('1080p');
    buffer.stop();
  });

  it('handles undefined MediaRecorder environment gracefully', () => {
    vi.stubGlobal('MediaRecorder', undefined);

    const buffer = createReplayBuffer({
      competitionId: 7,
      arenaName: 'Grass Arena',
    });

    expect(buffer.supported).toBe(false);
    const stream = asMedia(new FakeMediaStream());
    expect(buffer.start(stream)).toBe(false);
  });

  it('caps stored clips at 25 per competition and evicts oldest', () => {
    let mockRecorder: MockRecorder | null = null;
    let fakeNow = 1000;

    const buffer = createReplayBuffer({
      competitionId: 100,
      arenaName: 'Main',
      now: () => fakeNow,
      createRecorder: () => {
        mockRecorder = new MockRecorder();
        return mockRecorder;
      },
      createObjectUrl: fakeUrlGenerator,
      revokeObjectUrl: fakeUrlRevoker,
    });

    buffer.start(asMedia(new FakeMediaStream()));
    mockRecorder!.emitChunk(new Blob(['init']));

    // Save 26 clips
    const saved: SavedReplayClip[] = [];
    for (let i = 1; i <= 26; i++) {
      fakeNow += 1000;
      mockRecorder!.emitChunk(new Blob([`data-${i}`]));
      const clip = buffer.saveClip(`Clip ${i}`);
      saved.push(clip!);
    }

    const comp100Clips = getSavedReplays(100);
    expect(comp100Clips).toHaveLength(25);
    // Oldest clip (Clip 1) was evicted
    expect(comp100Clips.find((c) => c.label === 'Clip 1')).toBeUndefined();
    // Most recent clip (Clip 26) is present
    expect(comp100Clips.find((c) => c.label === 'Clip 26')).toBeDefined();
    // Object URL of evicted clip was revoked
    expect(revokedUrls).toContain(saved[0].url);
  });

  it('manages in-memory saved replays store correctly', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSavedReplays(listener);

    const clip1: SavedReplayClip = {
      id: 'clip-1',
      competitionId: 1,
      arenaName: 'Arena 1',
      label: 'Heat 1',
      createdAt: '2026-10-24T12:00:00Z',
      durationSeconds: 15,
      mimeType: 'video/webm',
      blob: new Blob(['clip1']),
      url: 'blob:clip-1',
      hasFilmingOptOut: false,
    };

    const clip2: SavedReplayClip = {
      id: 'clip-2',
      competitionId: 2,
      arenaName: 'Arena 2',
      label: 'Heat 2',
      createdAt: '2026-10-24T12:05:00Z',
      durationSeconds: 12,
      mimeType: 'video/webm',
      blob: new Blob(['clip2']),
      url: 'blob:clip-2',
      hasFilmingOptOut: true,
    };

    const mockRevoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    addSavedReplay(clip1);
    addSavedReplay(clip2);
    expect(listener).toHaveBeenCalledTimes(2);

    expect(getSavedReplays()).toHaveLength(2);
    expect(getSavedReplays(1)).toHaveLength(1);
    expect(getSavedReplays(2)).toHaveLength(1);

    // markReplayAsHighlight with and without trim arguments
    const highlighted = markReplayAsHighlight('clip-1', 2, 8);
    expect(highlighted).not.toBeNull();
    expect(highlighted!.savedHighlight).toBe(true);
    expect(highlighted!.trimStartSeconds).toBe(2);
    expect(highlighted!.trimEndSeconds).toBe(8);

    const highlightedNoTrim = markReplayAsHighlight('clip-2');
    expect(highlightedNoTrim).not.toBeNull();
    expect(highlightedNoTrim!.savedHighlight).toBe(true);

    expect(markReplayAsHighlight('non-existent')).toBeNull();

    // updateReplayTrim
    const trimmed = updateReplayTrim('clip-1', 1, 9);
    expect(trimmed).not.toBeNull();
    expect(trimmed!.trimStartSeconds).toBe(1);
    expect(trimmed!.trimEndSeconds).toBe(9);
    expect(updateReplayTrim('non-existent', 0, 10)).toBeNull();

    // Clear by competition while keeping other competition clips
    clearSavedReplays(2);
    expect(getSavedReplays(2)).toHaveLength(0);
    expect(getSavedReplays(1)).toHaveLength(1);
    expect(mockRevoke).toHaveBeenCalledWith('blob:clip-2');

    // Remove single clip
    removeSavedReplay('clip-1');
    expect(getSavedReplays(1)).toHaveLength(0);
    expect(mockRevoke).toHaveBeenCalledWith('blob:clip-1');

    // Removing non-existent clip does nothing
    removeSavedReplay('clip-unknown');

    // Add and clear all
    addSavedReplay(clip1);
    clearSavedReplays();
    expect(getSavedReplays()).toHaveLength(0);

    unsubscribe();
    addSavedReplay(clip1);
    // Listener should not be called after unsubscribe
    expect(listener).toHaveBeenCalledTimes(9);
  });

  it('handles IndexedDB best-effort persistence gracefully', async () => {
    // When indexedDB is undefined
    vi.stubGlobal('indexedDB', undefined);
    const loaded = await loadPersistedReplays(1);
    expect(loaded).toEqual([]);

    // When indexedDB exists but open throws
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('IDB blocked');
      },
    });
    const loaded2 = await loadPersistedReplays(1);
    expect(loaded2).toEqual([]);
  });

  it('handles IndexedDB operations with simulated DB success', async () => {
    const mockStore: Record<string, unknown> = {};
    const mockDb = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore: vi.fn(),
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
          put: vi.fn((item: { id: string }) => {
            mockStore[item.id] = item;
          }),
          delete: vi.fn((id: string) => {
            delete mockStore[id];
          }),
          clear: vi.fn(() => {
            for (const key of Object.keys(mockStore)) delete mockStore[key];
          }),
          getAll: vi.fn(() => {
            const req = {
              result: Object.values(mockStore),
              onsuccess: null as (() => void) | null,
            };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          }),
        })),
      })),
    };

    const fakeIDB = {
      open: vi.fn<() => unknown>(() => {
        const req = {
          result: mockDb,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
        };
        setTimeout(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        }, 0);
        return req;
      }),
    };

    vi.stubGlobal('indexedDB', fakeIDB);

    const clip: SavedReplayClip = {
      id: 'persisted-1',
      competitionId: 99,
      arenaName: 'Ring 1',
      label: 'Final Race',
      createdAt: '2026-10-24T15:00:00Z',
      durationSeconds: 14,
      mimeType: 'video/webm',
      blob: new Blob(['video']),
      url: 'blob:persisted-1',
    };

    addSavedReplay(clip);
    markReplayAsHighlight('persisted-1', 2, 10);
    updateReplayTrim('persisted-1', 1, 12);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Clear in-memory so loadPersistedReplays tests the 'else' branch (rebuilding from IDB)
    clearSavedReplays();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Re-put clip in mockStore
    mockStore['persisted-1'] = {
      ...clip,
      savedHighlight: undefined,
      trimStartSeconds: undefined,
      trimEndSeconds: undefined,
      trimStartSec: undefined,
      trimEndSec: undefined,
    };
    mockStore['persisted-with-kf'] = {
      ...clip,
      id: 'persisted-with-kf',
      savedHighlight: true,
      followKeyframes: [{ timeSec: 2, zoom: 2.5, panX: 10, panY: 20 }],
    };

    const loadedAll = await loadPersistedReplays();
    expect(loadedAll.length).toBeGreaterThanOrEqual(2);
    expect(loadedAll[0].savedHighlight).toBe(false);
    expect(loadedAll[0].trimStartSeconds).toBe(0);
    const kfItem = loadedAll.find((c) => c.id === 'persisted-with-kf');
    expect(kfItem?.followKeyframes).toHaveLength(1);

    // Calling with competitionId when items already exist in memory
    const loadedFiltered = await loadPersistedReplays(99);
    expect(loadedFiltered).toHaveLength(2);

    // loadPersistedReplays empty result branch (req.result is undefined)
    const mockDbEmpty = {
      objectStoreNames: { contains: vi.fn(() => true) },
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
          getAll: vi.fn(() => {
            const req = {
              result: undefined,
              onsuccess: null as (() => void) | null,
            };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          }),
        })),
      })),
    };
    fakeIDB.open.mockImplementationOnce(() => {
      const req = {
        result: mockDbEmpty,
        onsuccess: null as (() => void) | null,
      };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    });
    const emptyResultLoad = await loadPersistedReplays();
    expect(emptyResultLoad).toEqual([]);

    // loadPersistedReplays error branch
    const mockDbErr = {
      objectStoreNames: { contains: vi.fn(() => true) },
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
          getAll: vi.fn(() => {
            const req = {
              onerror: null as (() => void) | null,
            };
            setTimeout(() => req.onerror?.(), 0);
            return req;
          }),
        })),
      })),
    };
    fakeIDB.open.mockImplementationOnce(() => {
      const req = {
        result: mockDbErr,
        onsuccess: null as (() => void) | null,
      };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    });
    const failedLoad = await loadPersistedReplays();
    expect(failedLoad).toEqual([]);

    // openReplayDb error branch
    fakeIDB.open.mockImplementationOnce(() => {
      const req = {
        onerror: null as (() => void) | null,
      };
      setTimeout(() => req.onerror?.(), 0);
      return req;
    });
    const failedOpen = await loadPersistedReplays();
    expect(failedOpen).toEqual([]);

    // loadPersistedReplays sync exception branch
    fakeIDB.open.mockImplementationOnce(() => {
      throw new Error('IDB sync open crash');
    });
    const syncFailLoad = await loadPersistedReplays();
    expect(syncFailLoad).toEqual([]);

    // Test removeSavedReplay executing removePersistedClip
    addSavedReplay(clip);
    await new Promise((resolve) => setTimeout(resolve, 20));
    removeSavedReplay(clip.id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Test clearSavedReplays(99) executing clearPersistedClips with competition ID
    const clipDiffComp = { ...clip, id: 'persisted-diff-comp', competitionId: 88 };
    addSavedReplay(clip);
    addSavedReplay(clipDiffComp);
    await new Promise((resolve) => setTimeout(resolve, 20));
    clearSavedReplays(99);
    await new Promise((resolve) => setTimeout(resolve, 20));
    clearSavedReplays();
  });

  it('tolerates revoker and stop errors without throwing', () => {
    const mockRec = new MockRecorder();
    const buffer = createReplayBuffer({
      competitionId: 1,
      arenaName: 'Main',
      createRecorder: () => mockRec,
      createObjectUrl: fakeUrlGenerator,
      revokeObjectUrl: () => {
        throw new Error('Revoker failed');
      },
    });

    buffer.start(asMedia(new FakeMediaStream()));
    mockRec.emitChunk(new Blob(['test-data']));
    // save clip with failing revoker
    const clip = buffer.saveClip('Error clip');
    expect(clip).not.toBeNull();
    // remove clip should not throw
    expect(() => removeSavedReplay(clip!.id)).not.toThrow();

    // URL.revokeObjectURL throwing
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      throw new Error('URL revoke failed');
    });
    const clip2: SavedReplayClip = {
      id: 'clip-err-2',
      competitionId: 1,
      arenaName: 'Arena',
      label: 'Err 2',
      createdAt: new Date().toISOString(),
      durationSeconds: 10,
      mimeType: 'video/webm',
      blob: new Blob([]),
      url: 'blob:throw',
    };
    addSavedReplay(clip2);
    expect(() => removeSavedReplay('clip-err-2')).not.toThrow();

    // Recorder stop throwing
    const recWithThrowingStop = new MockRecorder();
    recWithThrowingStop.stop = vi.fn(() => {
      throw new Error('Stop failed');
    });
    const bufferStopThrow = createReplayBuffer({
      competitionId: 1,
      arenaName: 'Main',
      createRecorder: () => recWithThrowingStop,
    });
    bufferStopThrow.start(asMedia(new FakeMediaStream()));
    expect(() => bufferStopThrow.stop()).not.toThrow();
  });

  it('handles global MediaRecorder constructor throwing when createRecorder is absent', () => {
    class ThrowingMediaRecorder {
      static isTypeSupported = vi.fn(() => true);
      constructor() {
        throw new Error('Global MediaRecorder constructor failed');
      }
    }
    vi.stubGlobal('MediaRecorder', ThrowingMediaRecorder);

    const buffer = createReplayBuffer({
      competitionId: 1,
      arenaName: 'Arena',
    });
    expect(buffer.start(asMedia(new FakeMediaStream()))).toBe(false);
    expect(buffer.supported).toBe(false);
  });

  it('covers IDB upgradeneeded store creation and open throwing synchronously', async () => {
    const mockDbNew = {
      objectStoreNames: { contains: vi.fn(() => false) },
      createObjectStore: vi.fn(),
      transaction: vi.fn(() => ({
        objectStore: vi.fn(() => ({
          put: vi.fn(),
        })),
      })),
    };
    const fakeIDB2 = {
      open: vi.fn<() => unknown>(() => {
        const req = {
          result: mockDbNew,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
        };
        setTimeout(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        }, 0);
        return req;
      }),
    };
    vi.stubGlobal('indexedDB', fakeIDB2);

    const clip: SavedReplayClip = {
      id: 'upgrade-1',
      competitionId: 88,
      arenaName: 'Ring',
      label: 'Race',
      createdAt: new Date().toISOString(),
      durationSeconds: 10,
      mimeType: 'video/webm',
      blob: new Blob([]),
      url: 'blob:upg',
    };
    addSavedReplay(clip);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockDbNew.createObjectStore).toHaveBeenCalledWith('clips', { keyPath: 'id' });

    // Open throwing synchronously
    fakeIDB2.open.mockImplementationOnce(() => {
      throw new Error('Sync IDB open failure');
    });
    const result = await loadPersistedReplays(88);
    expect(result).toEqual([]);

    // Transaction throwing synchronously
    const mockDbThrow = {
      transaction: () => {
        throw new Error('Transaction failure');
      },
    };
    fakeIDB2.open.mockImplementationOnce(() => {
      const req = {
        result: mockDbThrow,
        onsuccess: null as (() => void) | null,
      };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    });
    const resultThrow = await loadPersistedReplays();
    expect(resultThrow).toEqual([]);
  });

  it('covers crypto randomUUID fallback, whitespace labels, and option inheritance', () => {
    const originalRandomUUID = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const mockRec = new MockRecorder();
    const buffer = createReplayBuffer({
      competitionId: 12,
      arenaName: 'South Ring',
      hasFilmingOptOut: true,
      resolutionLabel: '720p',
      createRecorder: () => mockRec,
      createObjectUrl: fakeUrlGenerator,
      revokeObjectUrl: fakeUrlRevoker,
    });

    buffer.start(asMedia(new FakeMediaStream()));
    mockRec.emitChunk(new Blob(['data']));

    // Whitespace label falls back to default label; inherits hasFilmingOptOut and resolutionLabel
    const clip = buffer.saveClip('   ', 0);
    expect(clip).not.toBeNull();
    expect(clip!.label).toBe('South Ring Replay');
    expect(clip!.id).toMatch(/^clip-/);
    expect(clip!.hasFilmingOptOut).toBe(true);
    expect(clip!.resolutionLabel).toBe('720p');

    // Restore randomUUID
    Object.defineProperty(crypto, 'randomUUID', {
      value: originalRandomUUID,
      configurable: true,
      writable: true,
    });
  });

  it('handles browser MediaRecorder when isTypeSupported returns false for all formats', () => {
    let recorderConfig: MediaRecorderOptions | undefined = undefined;
    class NoTypeMediaRecorder {
      static isTypeSupported = vi.fn(() => false);
      state = 'inactive';
      mimeType = '';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      start = vi.fn(() => {
        this.state = 'recording';
      });
      stop = vi.fn();
      constructor(_stream: MediaStream, config?: MediaRecorderOptions) {
        recorderConfig = config;
      }
    }
    vi.stubGlobal('MediaRecorder', NoTypeMediaRecorder);

    const buffer = createReplayBuffer({
      competitionId: 1,
      arenaName: 'Arena',
    });
    expect(buffer.start(asMedia(new FakeMediaStream()))).toBe(true);
    // Config should be undefined when no mime type supported
    expect(recorderConfig).toBeUndefined();
    buffer.stop();
  });

  it('exports trimmed clips with blob slicing, keyframes, and store synchronization', () => {
    const rawData = '0123456789ABCDEF0123456789ABCDEF'; // 32 bytes
    const blob = new Blob([rawData], { type: 'video/webm' });
    const clip: SavedReplayClip = {
      id: 'clip-trim-test',
      competitionId: 10,
      arenaName: 'Main Arena',
      label: 'Heat 1 Final',
      createdAt: '2026-10-24T12:00:00Z',
      durationSeconds: 10,
      mimeType: 'video/webm',
      blob,
      url: 'blob:clip-trim-test',
      savedHighlight: false,
      trimStartSeconds: 0,
      trimEndSeconds: 10,
    };

    addSavedReplay(clip);

    const keyframes: FollowKeyframe[] = [
      { timeSec: 2, zoom: 2, panX: 100, panY: 0 },
      { timeSec: 6, zoom: 3, panX: -100, panY: 0 },
    ];

    // Trim middle segment: 2s to 8s
    const trimmed = exportTrimmedClip(clip, 2, 8, keyframes, (b) => `blob:trimmed-${b.size}`);
    expect(trimmed.savedHighlight).toBe(true);
    expect(trimmed.trimStartSec).toBe(2);
    expect(trimmed.trimEndSec).toBe(8);
    expect(trimmed.trimStartSeconds).toBe(2);
    expect(trimmed.trimEndSeconds).toBe(8);
    expect(trimmed.durationSeconds).toBe(6);
    expect(trimmed.followKeyframes).toEqual(keyframes);
    expect(trimmed.url).toContain('blob:trimmed-');
    expect(trimmed.blob.size).toBeLessThan(blob.size);

    // Verify in-memory store was updated with the trimmed clip
    const stored = getSavedReplays(10).find((c) => c.id === clip.id);
    expect(stored?.savedHighlight).toBe(true);
    expect(stored?.trimStartSec).toBe(2);
    expect(stored?.followKeyframes).toHaveLength(2);

    // Full duration trim returns original blob
    const untrimmed = exportTrimmedClip(clip, 0, 10);
    expect(untrimmed.blob).toBe(clip.blob);

    // Clamping edge cases
    const clamped = exportTrimmedClip(clip, -5, 100);
    expect(clamped.trimStartSec).toBe(0);
    expect(clamped.trimEndSec).toBe(10);

    // Trimming clip with empty blob
    const emptyBlobClip: SavedReplayClip = {
      ...clip,
      id: 'clip-empty-blob',
      durationSeconds: 10,
      blob: new Blob([]),
    };
    const trimmedEmpty = exportTrimmedClip(emptyBlobClip, 2, 8);
    expect(trimmedEmpty.durationSeconds).toBe(6);
  });

  it('supports followKeyframes in markReplayAsHighlight and updateReplayTrim', () => {
    const clip: SavedReplayClip = {
      id: 'clip-kf-test',
      competitionId: 12,
      arenaName: 'Main',
      label: 'Race 1',
      createdAt: '2026-10-24T14:00:00Z',
      durationSeconds: 15,
      mimeType: 'video/webm',
      blob: new Blob(['data']),
      url: 'blob:kf-1',
    };
    addSavedReplay(clip);

    const kf: FollowKeyframe[] = [{ timeSec: 1, zoom: 2, panX: 50, panY: 0 }];
    const updated = updateReplayTrim('clip-kf-test', 2, 10, kf);
    expect(updated?.trimStartSec).toBe(2);
    expect(updated?.trimEndSec).toBe(10);
    expect(updated?.followKeyframes).toEqual(kf);

    const kf2: FollowKeyframe[] = [{ timeSec: 3, zoom: 3, panX: -50, panY: 0 }];
    const highlighted = markReplayAsHighlight('clip-kf-test', 3, 9, kf2);
    expect(highlighted?.savedHighlight).toBe(true);
    expect(highlighted?.trimStartSec).toBe(3);
    expect(highlighted?.trimEndSec).toBe(9);
    expect(highlighted?.followKeyframes).toEqual(kf2);
  });
});

