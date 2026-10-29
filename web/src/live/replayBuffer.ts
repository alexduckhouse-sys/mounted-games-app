import { encodeReplay, replayMimeType, type ReplayEncodingOptions, type ReplaySource } from './replayEncoding';
import { ReplaySegmentStore } from './replaySegments';
/**
 * Rolling circular session buffer for live stream instant replay clips and referee race reviews.
 * Keeps complete native-resolution recordings on device, subject to storage limits.
 * Requested clips are decoded and encoded into a new playable recording.
 */

export interface FollowKeyframe {
  timeSec: number;
  zoom: number;
  panX: number;
  panY: number;
  viewportWidth?: number;
  viewportHeight?: number;
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
  storageWarning?: string;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  trimStartSec?: number;
  trimEndSec?: number;
  followKeyframes?: FollowKeyframe[];
  resolutionLabel?: string;
  /** Where the clip came from: a race recording made when a race was scored, or an instant replay. Absent for other clips. */
  source?: 'race' | 'instant';
  races?: ReadonlyArray<{
    id: number;
    name: string;
    orderIndex: number;
    startedAt?: string | null;
    finishedAt?: string | null;
    isComplete?: boolean;
  }>;
}

export interface ReplayBufferOptions {
  competitionId: number;
  streamId?: number;
  arenaName: string;
  windowSeconds?: number; // default 1800 (30 minutes)
  /** Keep earlier cameras in this arena when a media stream is replaced. */
  retainOnSwitch?: boolean;
  timesliceMs?: number; // default 1000
  resolutionLabel?: string;
  createRecorder?: (stream: MediaStream, mimeType?: string) => MediaRecorderLike;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  now?: () => number;
  segmentSeconds?: number;
  memoryLimitBytes?: number;
  diskLimitBytes?: number;
  onStatus?: (status: ReplayBufferStatus) => void;
  encode?: (sources: ReplaySource[], options: ReplayEncodingOptions) => Promise<Blob>;
}

export interface ReplayBufferStatus { retainedSeconds: number; warning?: string }

export interface MediaRecorderLike {
  state: 'inactive' | 'recording' | 'paused';
  mimeType?: string;
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onerror?: ((ev: unknown) => void) | null;
  onstop: (() => void) | null;
  start: (timeslice?: number) => void;
  stop: () => void;
}

export type SaveClipOptions = ReplayEncodingOptions & {
  durationSeconds?: number;
  offsetAgoSeconds?: number;
  resolutionLabel?: string;
};

export interface ReplayBufferHandle {
  readonly supported: boolean;
  readonly recording: boolean;
  start: (stream: MediaStream) => boolean;
  stop: () => void;
  dispose: () => void;
  saveClip: (
    label?: string,
    durationOrOptions?: number | SaveClipOptions,
    offsetAgoSeconds?: number
  ) => Promise<SavedReplayClip | null>;
  markRaceBookmark: (raceLabel: string, durationSeconds?: number) => Promise<SavedReplayClip | null>;
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
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persistClip(clip: SavedReplayClip): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openReplayDb();
    if (!db) throw new Error('Device storage unavailable');
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      tx.objectStore(STORE_NAME).put({
        id: clip.id, competitionId: clip.competitionId, streamId: clip.streamId,
        arenaName: clip.arenaName, label: clip.label, createdAt: clip.createdAt,
        durationSeconds: clip.durationSeconds, mimeType: clip.mimeType, blob: clip.blob,
        savedHighlight: clip.savedHighlight, trimStartSeconds: clip.trimStartSeconds,
        trimEndSeconds: clip.trimEndSeconds, followKeyframes: clip.followKeyframes,
        resolutionLabel: clip.resolutionLabel,
        source: clip.source, races: clip.races,
      });
    });
    clip.storageWarning = undefined;
  } catch {
    clip.storageWarning = 'This replay is only available in this tab. Download it before leaving.';
  } finally {
    db?.close();
    if (savedReplays.includes(clip)) notifyListeners();
  }
}

async function removePersistedClip(id: string): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openReplayDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      tx.objectStore(STORE_NAME).delete(id);
    });
  } catch {
    // Ignore IndexedDB failures
  } finally {
    db?.close();
  }
}

async function clearPersistedClips(competitionId?: number): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openReplayDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
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
    });
  } catch {
    // Ignore IndexedDB failures
  } finally {
    db?.close();
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

  // A byte limit also bounds the in-memory saved-clip collection on phones.
  while (savedReplays.length > 1 && (savedReplays.filter((c) => c.competitionId === clip.competitionId).length > 25
    || savedReplays.reduce((sum, c) => sum + c.blob.size, 0) > 128 * 1024 * 1024)) {
    const overCount = savedReplays.filter((c) => c.competitionId === clip.competitionId).length > 25;
    const index = savedReplays.findIndex((c) => c.id !== clip.id && (!overCount || c.competitionId === clip.competitionId));
    const [evicted] = savedReplays.splice(index, 1);
    safeRevokeUrl(evicted.url); void removePersistedClip(evicted.id);
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

/** Remembers where a clip came from, so the Replay tab can list race recordings apart from the rest. */
export function tagSavedReplay(clipId: string, source: NonNullable<SavedReplayClip['source']>): SavedReplayClip | null {
  const clip = savedReplays.find((c) => c.id === clipId);
  if (!clip) return null;
  clip.source = source;
  void persistClip(clip);
  notifyListeners();
  return clip;
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

export async function exportTrimmedClip(
  clip: SavedReplayClip,
  trimStartSec: number,
  trimEndSec: number,
  followKeyframes?: FollowKeyframe[],
  options: ReplayEncodingOptions = {},
): Promise<SavedReplayClip> {
  const start = Math.max(0, Math.min(trimStartSec, clip.durationSeconds));
  const end = Math.max(start, Math.min(trimEndSec, clip.durationSeconds));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Choose a start before the end of the clip.');
  const blob = await encodeReplay([{ load: async () => clip.blob, from: start, to: end }], options);
  if (options.signal?.aborted) throw new DOMException('Replay preparation cancelled.', 'AbortError');
  const exported: SavedReplayClip = {
    ...clip, id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), mimeType: blob.type,
    createdAt: new Date().toISOString(), durationSeconds: end - start, savedHighlight: true,
    trimStartSec: 0, trimEndSec: end - start, trimStartSeconds: 0, trimEndSeconds: end - start,
    // The original keeps editable keyframes; the new clip already contains their rendered movement.
    followKeyframes: undefined,
  };
  updateReplayTrim(clip.id, start, end, followKeyframes);
  addSavedReplay(exported);
  return exported;
}

export async function loadPersistedReplays(
  competitionId?: number,
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): Promise<SavedReplayClip[]> {
  const db = await openReplayDb();
  if (!db) return [];
  try {
    return await new Promise((resolve) => {
      const loaded: SavedReplayClip[] = [];
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).openCursor();
      let retainedBytes = savedReplays.reduce((sum, clip) => sum + clip.blob.size, 0);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { notifyListeners(); resolve(loaded); return; }
        const item = cursor.value as SavedReplayClip;
        if (competitionId === undefined || item.competitionId === competitionId) {
          const existing = savedReplays.find((clip) => clip.id === item.id);
          if (existing) loaded.push(existing);
          else if (item.blob instanceof Blob && retainedBytes + item.blob.size <= 128 * 1024 * 1024) {
            const start = item.trimStartSec ?? item.trimStartSeconds ?? 0;
            const end = item.trimEndSec ?? item.trimEndSeconds ?? item.durationSeconds;
            const clip = { ...item, url: createUrl(item.blob), savedHighlight: item.savedHighlight ?? false,
              trimStartSec: start, trimEndSec: end, trimStartSeconds: start, trimEndSeconds: end,
              followKeyframes: item.followKeyframes ? [...item.followKeyframes] : undefined };
            retainedBytes += item.blob.size; savedReplays.push(clip); loaded.push(clip);
          }
        }
        cursor.continue();
      };
      request.onerror = () => resolve([]);
    });
  } catch { return []; }
  finally { db.close(); }
}

export const hydrateSavedReplays = loadPersistedReplays;

export function createReplayBuffer(options: ReplayBufferOptions): ReplayBufferHandle {
  const now = options.now ?? Date.now;
  const store = new ReplaySegmentStore((options.windowSeconds ?? 1800) * 1000, options.memoryLimitBytes, options.diskLimitBytes);
  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const encode = options.encode ?? encodeReplay;
  const segmentMs = Math.min(10, Math.max(1, options.segmentSeconds ?? 10)) * 1000;
  let supported = Boolean(options.createRecorder) || Boolean(replayMimeType());
  let recording = false;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorderLike | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped: Promise<void> = Promise.resolve();
  let epoch = 0;
  let historyEpoch = 0;
  let sequence = 0;
  let saving = false;
  const sessionId = crypto.randomUUID();
  const activeExports = new Set<AbortController>();
  const status = () => options.onStatus?.({ retainedSeconds: store.retainedSeconds, warning: store.warning });

  function beginSegment() {
    if (!recording || !stream) return;
    const ticket = epoch;
    const historyTicket = historyEpoch;
    const mimeType = replayMimeType();
    const startedAt = now();
    const parts: Blob[] = [];
    let segmentTimer: ReturnType<typeof setTimeout> | undefined;
    let bytes = 0;
    let settle!: () => void;
    stopped = new Promise<void>((resolve) => { settle = resolve; });
    try {
      const current: MediaRecorderLike = options.createRecorder ? options.createRecorder(stream, mimeType)
        : new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 }) as unknown as MediaRecorderLike;
      recorder = current;
      current.ondataavailable = ({ data }) => {
        if (!data.size || historyTicket !== historyEpoch) return;
        bytes += data.size;
        if (bytes > 32 * 1024 * 1024) {
          if (ticket !== epoch) return;
          recording = false; store.warning = 'Recording used too much memory. Replay recording has stopped.'; status();
          if (current.state !== 'inactive') current.stop();
          return;
        }
        parts.push(data);
      };
      current.onerror = (event) => {
        if (ticket !== epoch) return;
        const error = (event as { error?: { name?: string } })?.error;
        if (error?.name !== 'InvalidModificationError') recording = false;
        store.warning = recording ? 'The recording changed. Replay recording is restarting.' : 'Replay recording stopped. Restart the camera to try again.';
        status();
      };
      current.onstop = () => {
        clearTimeout(segmentTimer);
        const endedAt = now();
        if (recorder === current) recorder = null;
        // Every blob below contains ALL chunks of one completed recorder session.
        const blob = new Blob(parts, { type: current.mimeType || mimeType || 'video/webm' });
        const saved = historyTicket === historyEpoch && blob.size > 0 && bytes <= 32 * 1024 * 1024
          ? store.add({ id: `${sessionId}-${sequence++}`, start: startedAt, end: endedAt, size: blob.size, blob, pins: 0 })
          : Promise.resolve();
        void saved.finally(() => { status(); settle(); });
        if (recording && ticket === epoch) beginSegment();
      };
      current.start(options.timesliceMs ?? 1000);
      timer = segmentTimer = setTimeout(() => { if (current.state !== 'inactive') current.stop(); }, segmentMs);
    } catch {
      supported = false; recording = false;
      store.warning = 'This browser could not start replay recording.'; status(); settle();
    }
  }
  const restartTracks = () => {
    // Adding/removing tracks ends MediaRecorder. Close this segment before starting the new track set.
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };
  const stop = () => {
    recording = false;
    clearTimeout(timer);
    stream?.removeEventListener?.('addtrack', restartTracks);
    stream?.removeEventListener?.('removetrack', restartTracks);
    for (const controller of activeExports) controller.abort();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };
  const start = (next: MediaStream): boolean => {
    stop(); epoch++;
    if (!options.retainOnSwitch) { historyEpoch++; store.clear(); }
    stream = next;
    if (!next) return false;
    recording = true;
    next.addEventListener?.('addtrack', restartTracks);
    next.addEventListener?.('removetrack', restartTracks);
    beginSegment();
    return recording;
  };
  const saveClip = async (label?: string, durationOrOptions?: number | SaveClipOptions, offsetAgoSeconds = 0): Promise<SavedReplayClip | null> => {
    if (saving) throw new Error('A replay is already being prepared. Wait or cancel it first.');
    const settings = typeof durationOrOptions === 'object' ? durationOrOptions : {};
    const duration = typeof durationOrOptions === 'number' ? durationOrOptions : settings.durationSeconds ?? 15;
    const offset = settings.offsetAgoSeconds ?? offsetAgoSeconds;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(offset) || offset < 0) throw new Error('Choose a valid replay time range.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    settings.signal?.addEventListener('abort', abort, { once: true });
    if (settings.signal?.aborted) controller.abort();
    activeExports.add(controller); saving = true;
    const end = now() - offset * 1000;
    const start = end - duration * 1000;
    let selected: typeof store.segments = [];
    try {
      // Finish the current segment to obtain a valid container before reading it.
      const pending = stopped;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      await new Promise<void>((resolve, reject) => {
        const cancelled = () => reject(new DOMException('Replay preparation cancelled.', 'AbortError'));
        controller.signal.addEventListener('abort', cancelled, { once: true });
        void pending.then(() => { controller.signal.removeEventListener('abort', cancelled); resolve(); });
        if (controller.signal.aborted) cancelled();
      });
      if (controller.signal.aborted) throw new DOMException('Replay preparation cancelled.', 'AbortError');
      store.prune(now());
      selected = store.segments.filter((segment) => segment.end > start && segment.start < end);
      if (!selected.length) return null;
      selected.forEach((segment) => segment.pins++);
      const sources = selected.map((segment) => ({
        load: () => store.read(segment),
        from: Math.max(0, (start - segment.start) / 1000),
        to: Math.min(segment.end - segment.start, end - segment.start) / 1000,
      }));
      const blob = await encode(sources, { signal: controller.signal, onProgress: settings.onProgress });
      if (controller.signal.aborted) throw new DOMException('Replay preparation cancelled.', 'AbortError');
      const url = createObjectUrl(blob);
      if (options.revokeObjectUrl) customRevokers.set(url, options.revokeObjectUrl);
      const seconds = sources.reduce((sum, source) => sum + source.to - source.from, 0);
      const clip: SavedReplayClip = {
        id: crypto.randomUUID(), competitionId: options.competitionId, streamId: options.streamId,
        arenaName: options.arenaName, label: label?.trim() || `${options.arenaName} Replay`, createdAt: new Date(now()).toISOString(),
        durationSeconds: seconds, mimeType: blob.type, blob, url, savedHighlight: false,
        trimStartSeconds: 0, trimEndSeconds: seconds, trimStartSec: 0, trimEndSec: seconds,
        resolutionLabel: settings.resolutionLabel ?? options.resolutionLabel,
      };
      addSavedReplay(clip); return clip;
    } finally {
      selected.forEach((segment) => segment.pins--); store.prune(now()); status();
      settings.signal?.removeEventListener('abort', abort); activeExports.delete(controller); saving = false;
    }
  };
  return {
    get supported() { return supported; }, get recording() { return recording; }, start, stop, dispose: () => { stop(); epoch++; historyEpoch++; void stopped.finally(() => store.dispose()); }, saveClip,
    markRaceBookmark: (label, seconds = 45) => saveClip(label, seconds), chunkCount: () => store.segments.length,
  };
}
