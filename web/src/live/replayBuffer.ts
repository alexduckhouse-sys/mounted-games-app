/**
 * Rolling circular session buffer for live stream instant replay clips and referee race reviews.
 * Captures up to 30 minutes of recent video chunks using MediaRecorder and preserves
 * the initialisation header chunk for valid WebM/MP4 playback.
 */

export interface FollowKeyframe {
  timeSec: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface SavedReplayClip {
  id: string;
  competitionId: number;
  streamId?: number;
  arenaName: string;
  label: string;
  createdAt: string; // ISO string
  durationSeconds: number;
  mimeType: string;
  blob: Blob;
  url: string;
  savedHighlight?: boolean;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  trimStartSec?: number;
  trimEndSec?: number;
  followKeyframes?: FollowKeyframe[];
  resolutionLabel?: string;
  hasFilmingOptOut?: boolean;
}

export interface ReplayBufferOptions {
  competitionId: number;
  streamId?: number;
  arenaName: string;
  windowSeconds?: number; // default 1800 (30 minutes)
  timesliceMs?: number; // default 1000
  hasFilmingOptOut?: boolean;
  resolutionLabel?: string;
  createRecorder?: (stream: MediaStream, mimeType?: string) => MediaRecorderLike;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  now?: () => number;
}

export interface MediaRecorderLike {
  state: 'inactive' | 'recording' | 'paused';
  mimeType?: string;
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onerror?: ((ev: unknown) => void) | null;
  start: (timeslice?: number) => void;
  stop: () => void;
}

export type SaveClipOptions = {
  durationSeconds?: number;
  offsetAgoSeconds?: number;
  hasFilmingOptOut?: boolean;
  resolutionLabel?: string;
};

export interface ReplayBufferHandle {
  readonly supported: boolean;
  readonly recording: boolean;
  start: (stream: MediaStream) => boolean;
  stop: () => void;
  saveClip: (
    label?: string,
    durationOrOptions?: number | SaveClipOptions,
    offsetAgoSeconds?: number
  ) => SavedReplayClip | null;
  markRaceBookmark: (raceLabel: string, durationSeconds?: number) => SavedReplayClip | null;
  chunkCount: () => number;
}

const DB_NAME = 'mg-replay-clips';
const STORE_NAME = 'clips';
const DB_VERSION = 1;

// In-memory session store of saved replays
let savedReplays: SavedReplayClip[] = [];
const listeners = new Set<() => void>();
const customRevokers = new Map<string, (url: string) => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function safeRevokeUrl(url: string): void {
  const custom = customRevokers.get(url);
  if (custom) {
    customRevokers.delete(url);
    try {
      custom(url);
    } catch {
      // Ignore revoker errors
    }
    return;
  }
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Ignore URL revocation errors
  }
}

function openReplayDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persistClip(clip: SavedReplayClip): Promise<void> {
  try {
    const db = await openReplayDb();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      id: clip.id,
      competitionId: clip.competitionId,
      streamId: clip.streamId,
      arenaName: clip.arenaName,
      label: clip.label,
      createdAt: clip.createdAt,
      durationSeconds: clip.durationSeconds,
      mimeType: clip.mimeType,
      blob: clip.blob,
      savedHighlight: clip.savedHighlight,
      trimStartSeconds: clip.trimStartSeconds,
      trimEndSeconds: clip.trimEndSeconds,
      resolutionLabel: clip.resolutionLabel,
      hasFilmingOptOut: clip.hasFilmingOptOut,
    });
  } catch {
    // Ignore IndexedDB failures
  }
}

async function removePersistedClip(id: string): Promise<void> {
  try {
    const db = await openReplayDb();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
  } catch {
    // Ignore IndexedDB failures
  }
}

async function clearPersistedClips(competitionId?: number): Promise<void> {
  try {
    const db = await openReplayDb();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    if (competitionId === undefined) {
      store.clear();
    } else {
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result as SavedReplayClip[];
        for (const item of items) {
          if (item.competitionId === competitionId) {
            store.delete(item.id);
          }
        }
      };
    }
  } catch {
    // Ignore IndexedDB failures
  }
}

export function getSavedReplays(competitionId?: number): SavedReplayClip[] {
  if (competitionId === undefined) {
    return [...savedReplays];
  }
  return savedReplays.filter((c) => c.competitionId === competitionId);
}

export function addSavedReplay(clip: SavedReplayClip): void {
  savedReplays.push(clip);
  void persistClip(clip);

  // Cap stored clips per competition at 25 (evicting the oldest)
  const compClips = savedReplays.filter((c) => c.competitionId === clip.competitionId);
  if (compClips.length > 25) {
    const excess = compClips.length - 25;
    const toEvict = compClips.slice(0, excess);
    const evictIds = new Set(toEvict.map((e) => e.id));
    savedReplays = savedReplays.filter((c) => !evictIds.has(c.id));
    for (const evicted of toEvict) {
      safeRevokeUrl(evicted.url);
      void removePersistedClip(evicted.id);
    }
  }

  notifyListeners();
}

export function removeSavedReplay(id: string): void {
  const idx = savedReplays.findIndex((c) => c.id === id);
  if (idx !== -1) {
    const [removed] = savedReplays.splice(idx, 1);
    safeRevokeUrl(removed.url);
    void removePersistedClip(removed.id);
    notifyListeners();
  }
}

export function clearSavedReplays(competitionId?: number): void {
  if (competitionId === undefined) {
    for (const c of savedReplays) {
      safeRevokeUrl(c.url);
    }
    savedReplays = [];
  } else {
    const remaining: SavedReplayClip[] = [];
    for (const c of savedReplays) {
      if (c.competitionId === competitionId) {
        safeRevokeUrl(c.url);
      } else {
        remaining.push(c);
      }
    }
    savedReplays = remaining;
  }
  void clearPersistedClips(competitionId);
  notifyListeners();
}

export function subscribeSavedReplays(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function markReplayAsHighlight(
  clipId: string,
  trimStartSeconds?: number,
  trimEndSeconds?: number,
  followKeyframes?: FollowKeyframe[]
): SavedReplayClip | null {
  const clip = savedReplays.find((c) => c.id === clipId);
  if (!clip) return null;
  clip.savedHighlight = true;
  if (trimStartSeconds !== undefined) {
    clip.trimStartSeconds = trimStartSeconds;
    clip.trimStartSec = trimStartSeconds;
  }
  if (trimEndSeconds !== undefined) {
    clip.trimEndSeconds = trimEndSeconds;
    clip.trimEndSec = trimEndSeconds;
  }
  if (followKeyframes !== undefined) {
    clip.followKeyframes = [...followKeyframes];
  }
  void persistClip(clip);
  notifyListeners();
  return clip;
}

export function updateReplayTrim(
  clipId: string,
  trimStartSeconds: number,
  trimEndSeconds: number,
  followKeyframes?: FollowKeyframe[]
): SavedReplayClip | null {
  const clip = savedReplays.find((c) => c.id === clipId);
  if (!clip) return null;
  clip.trimStartSeconds = trimStartSeconds;
  clip.trimStartSec = trimStartSeconds;
  clip.trimEndSeconds = trimEndSeconds;
  clip.trimEndSec = trimEndSeconds;
  if (followKeyframes !== undefined) {
    clip.followKeyframes = [...followKeyframes];
  }
  void persistClip(clip);
  notifyListeners();
  return clip;
}

export function exportTrimmedClip(
  clip: SavedReplayClip,
  trimStartSec: number,
  trimEndSec: number,
  followKeyframes?: FollowKeyframe[],
  createUrl: (blob: Blob) => string = (b) => URL.createObjectURL(b)
): SavedReplayClip {
  const clampedStart = Math.max(0, Math.min(trimStartSec, clip.durationSeconds));
  const clampedEnd = Math.max(clampedStart, Math.min(trimEndSec, clip.durationSeconds));
  const trimmedDuration = Math.max(0.1, clampedEnd - clampedStart);

  let trimmedBlob = clip.blob;
  let trimmedUrl = clip.url;

  if (clampedStart > 0 || clampedEnd < clip.durationSeconds) {
    const totalBytes = clip.blob.size;
    if (totalBytes > 0 && clip.durationSeconds > 0) {
      const byteStart = Math.floor((clampedStart / clip.durationSeconds) * totalBytes);
      const byteEnd = Math.min(totalBytes, Math.ceil((clampedEnd / clip.durationSeconds) * totalBytes));
      trimmedBlob = clip.blob.slice(byteStart, Math.max(byteStart + 1, byteEnd), clip.mimeType);
      trimmedUrl = createUrl(trimmedBlob);
    }
  }

  const updated: SavedReplayClip = {
    ...clip,
    blob: trimmedBlob,
    url: trimmedUrl,
    durationSeconds: Number(trimmedDuration.toFixed(2)),
    savedHighlight: true,
    trimStartSec: clampedStart,
    trimEndSec: clampedEnd,
    trimStartSeconds: clampedStart,
    trimEndSeconds: clampedEnd,
    followKeyframes: followKeyframes ? [...followKeyframes] : clip.followKeyframes,
  };

  const existingIndex = savedReplays.findIndex((c) => c.id === clip.id);
  if (existingIndex >= 0) {
    savedReplays[existingIndex] = updated;
    void persistClip(updated);
    notifyListeners();
  }

  return updated;
}

export async function loadPersistedReplays(
  competitionId?: number,
  createUrl: (blob: Blob) => string = (b) => URL.createObjectURL(b)
): Promise<SavedReplayClip[]> {
  try {
    const db = await openReplayDb();
    if (!db) return [];
    const tx = db.transaction(STORE_NAME, 'readonly');
    return new Promise((resolve) => {
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const items = (req.result || []) as (Omit<SavedReplayClip, 'url'> & { url?: string })[];
        const filtered =
          competitionId !== undefined
            ? items.filter((item) => item.competitionId === competitionId)
            : items;
        const loaded: SavedReplayClip[] = [];
        for (const item of filtered) {
          const existing = savedReplays.find((c) => c.id === item.id);
          if (existing) {
            loaded.push(existing);
          } else {
            const url = createUrl(item.blob);
            const trimStart = item.trimStartSec ?? item.trimStartSeconds ?? 0;
            const trimEnd = item.trimEndSec ?? item.trimEndSeconds ?? item.durationSeconds;
            const clip: SavedReplayClip = {
              ...item,
              url,
              savedHighlight: item.savedHighlight ?? false,
              trimStartSeconds: trimStart,
              trimEndSeconds: trimEnd,
              trimStartSec: trimStart,
              trimEndSec: trimEnd,
              followKeyframes: item.followKeyframes ? [...item.followKeyframes] : undefined,
            };
            savedReplays.push(clip);
            loaded.push(clip);
          }
        }
        notifyListeners();
        resolve(loaded);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export const hydrateSavedReplays = loadPersistedReplays;

export function createReplayBuffer(options: ReplayBufferOptions): ReplayBufferHandle {
  const windowSeconds = options.windowSeconds ?? 1800; // default 30 minutes
  const timesliceMs = options.timesliceMs ?? 1000;
  const now = options.now ?? (() => Date.now());
  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));

  let supported = typeof options.createRecorder === 'function' || typeof MediaRecorder !== 'undefined';
  let recording = false;
  let recorder: MediaRecorderLike | null = null;
  let initChunk: Blob | null = null;
  let chunks: { blob: Blob; timestamp: number }[] = [];

  const prune = (currentTimestamp: number) => {
    const cutoff = currentTimestamp - windowSeconds * 1000;
    while (chunks.length > 0 && chunks[0].timestamp < cutoff) {
      chunks.shift();
    }
  };

  const stop = () => {
    if (!recording) return;
    recording = false;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Ignore recorder stop error
      }
    }
  };

  const start = (stream: MediaStream): boolean => {
    if (!stream) {
      return false;
    }
    if (recording) {
      stop();
    }
    chunks = [];
    initChunk = null;

    let mimeType: string | undefined;
    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
      const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ];
      mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c));
    }

    try {
      if (options.createRecorder) {
        recorder = options.createRecorder(stream, mimeType);
      } else {
        if (typeof MediaRecorder === 'undefined') {
          supported = false;
          return false;
        }
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined) as unknown as MediaRecorderLike;
      }
    } catch {
      supported = false;
      recording = false;
      return false;
    }

    if (!recorder) return false;

    recorder.ondataavailable = (ev: { data: Blob }) => {
      if (!ev.data || ev.data.size === 0) return;
      const t = now();
      if (!initChunk) {
        initChunk = ev.data;
      }
      chunks.push({ blob: ev.data, timestamp: t });
      prune(t);
    };

    recorder.onerror = () => {
      stop();
    };

    try {
      recorder.start(timesliceMs);
      recording = true;
      return true;
    } catch {
      supported = false;
      recording = false;
      return false;
    }
  };

  const saveClip = (
    label?: string,
    durationOrOptions?: number | SaveClipOptions,
    offsetAgoSeconds?: number
  ): SavedReplayClip | null => {
    const nowTs = now();
    prune(nowTs);
    if (chunks.length === 0) {
      return null;
    }

    const durationSec =
      typeof durationOrOptions === 'number'
        ? durationOrOptions
        : durationOrOptions?.durationSeconds ?? 60;

    const offsetSec =
      typeof durationOrOptions === 'number'
        ? (offsetAgoSeconds ?? 0)
        : (durationOrOptions?.offsetAgoSeconds ?? offsetAgoSeconds ?? 0);

    const clipOptions =
      typeof durationOrOptions === 'object' ? durationOrOptions : undefined;

    let relevantChunks = chunks;
    if (durationSec > 0 && chunks.length > 0) {
      const endCutoff = nowTs - offsetSec * 1000;
      const startCutoff = endCutoff - durationSec * 1000;
      const sliced = chunks.filter(
        (c) => c.timestamp >= startCutoff && c.timestamp <= endCutoff
      );
      if (sliced.length > 0) {
        relevantChunks = sliced;
      }
    }

    const rawBlobs = relevantChunks.map((c) => c.blob);
    const assembledBlobs: Blob[] = [];
    if (initChunk && rawBlobs[0] !== initChunk) {
      assembledBlobs.push(initChunk, ...rawBlobs);
    } else {
      assembledBlobs.push(...rawBlobs);
    }

    const clipMimeType = recorder?.mimeType || 'video/webm';
    const blob = new Blob(assembledBlobs, { type: clipMimeType });
    const url = createObjectUrl(blob);

    if (options.revokeObjectUrl) {
      customRevokers.set(url, options.revokeObjectUrl);
    }

    const firstTimestamp = relevantChunks[0].timestamp;
    const lastTimestamp = relevantChunks[relevantChunks.length - 1].timestamp;
    const durationSeconds = Math.max(
      1,
      Math.round((lastTimestamp - firstTimestamp + timesliceMs) / 1000)
    );

    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `clip-${nowTs}-${Math.random().toString(36).slice(2, 9)}`;

    const clipLabel = label?.trim() || `${options.arenaName} Replay`;

    const clip: SavedReplayClip = {
      id,
      competitionId: options.competitionId,
      streamId: options.streamId,
      arenaName: options.arenaName,
      label: clipLabel,
      createdAt: new Date(nowTs).toISOString(),
      durationSeconds,
      mimeType: clipMimeType,
      blob,
      url,
      savedHighlight: false,
      trimStartSeconds: 0,
      trimEndSeconds: durationSeconds,
      trimStartSec: 0,
      trimEndSec: durationSeconds,
      resolutionLabel: clipOptions?.resolutionLabel ?? options.resolutionLabel,
      hasFilmingOptOut: clipOptions?.hasFilmingOptOut ?? options.hasFilmingOptOut ?? false,
    };

    addSavedReplay(clip);
    return clip;
  };

  const markRaceBookmark = (raceLabel: string, durationSeconds = 60): SavedReplayClip | null => {
    return saveClip(raceLabel, durationSeconds, 0);
  };

  const chunkCount = () => chunks.length;

  return {
    get supported() {
      return supported;
    },
    get recording() {
      return recording;
    },
    start,
    stop,
    saveClip,
    markRaceBookmark,
    chunkCount,
  };
}
