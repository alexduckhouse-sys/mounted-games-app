/** Ephemeral DVR storage. RAM and disk are bounded independently; quota failures shorten history. */
export interface ReplaySegment {
  id: string;
  start: number;
  end: number;
  size: number;
  blob?: Blob;
  disk?: boolean;
  pins: number;
}
// A live owner protects its pinned exports as well as its rolling history. Crashed tabs expire independently
// of the window chosen by the next viewer; old schema rows get a conservative one-day orphan allowance.
const OWNER_LEASE_MS = 5 * 60_000;
const LEGACY_ORPHAN_MS = 24 * 60 * 60_000;
interface StoredSegment { id: string; end?: number; owner?: string; expiresAt?: number; leaseUntil?: number }
export class ReplaySegmentStore {
  readonly segments: ReplaySegment[] = [];
  warning: string | undefined;
  private database: Promise<IDBDatabase | null>;
  private readonly memoryLimit: number;
  private readonly diskLimit: number;
  private epoch = 0;
  private pendingBytes = 0;
  private pendingWrites = new Set<Promise<void>>();
  private disposed = false;
  private windowMs: number;
  private readonly owner = `owner:${crypto.randomUUID()}`;
  private renewTimer: ReturnType<typeof setInterval> | undefined;
  constructor(windowMs: number, memoryLimit = 64 * 1024 * 1024, diskLimit = 1024 * 1024 * 1024) {
    this.windowMs = windowMs; this.memoryLimit = memoryLimit; this.diskLimit = diskLimit;
    this.database = this.open();
  }
  private open(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      let finished = false;
      const finish = (db: IDBDatabase | null) => {
        if (finished) { db?.close(); return; }
        finished = true; clearTimeout(timeout); resolve(db);
      };
      const timeout = setTimeout(() => finish(null), 15_000);
      try {
        // Old open tabs still sweep their whole store using the viewer's window. Keep their recordings
        // intact and isolate new owner-aware buffers; saved replay clips use a separate database.
        const request = indexedDB.open('mg-replay-buffer-v2', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('segments', { keyPath: 'id' });
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
        request.onsuccess = () => {
          const db = request.result;
          if (finished) { db.close(); return; }
          try {
          // Remove abandoned sessions (including a previous tab crash) after the DVR window.
          const tx = db.transaction('segments', 'readwrite');
          const objects = tx.objectStore('segments');
          const cursor = objects.openCursor();
          const activeOwners = new Set<string>();
          const expired: Pick<StoredSegment, 'id' | 'owner'>[] = [];
          const now = Date.now();
          cursor.onsuccess = () => {
            const item = cursor.result;
            if (item) {
              const value = item.value as StoredSegment;
              if (value.leaseUntil !== undefined) {
                if (value.leaseUntil > now) activeOwners.add(value.id);
                else expired.push({ id: value.id, owner: value.owner });
              } else if ((value.expiresAt ?? (value.end ?? now) + LEGACY_ORPHAN_MS) < now) expired.push({ id: value.id, owner: value.owner });
              item.continue();
            } else {
              // One read/write transaction sees each owner's lease and records together.
              for (const value of expired) if (!value.owner || !activeOwners.has(value.owner)) objects.delete(value.id);
            }
          };
          finish(db);
          } catch { db.close(); finish(null); }
        };
      } catch { finish(null); }
    });
  }
  private renewLease(db: IDBDatabase): void {
    try {
      const tx = db.transaction('segments', 'readwrite');
      tx.objectStore('segments').put({ id: this.owner, leaseUntil: Date.now() + OWNER_LEASE_MS });
      // Quota/storage errors are also handled by the segment write, which falls back to RAM.
      tx.onerror = () => {};
    } catch { /* A closed database cannot retain new recordings either. */ }
  }
  async add(segment: ReplaySegment): Promise<void> {
    if (this.disposed) return;
    // Account for blobs waiting on slow storage as well as retained recordings.
    if (this.pendingBytes + segment.size > this.memoryLimit) {
      this.warning = 'Device storage is too slow. Some replay video could not be kept.';
      return;
    }
    this.pendingBytes += segment.size;
    let finished!: () => void;
    const pending = new Promise<void>((resolve) => { finished = resolve; });
    this.pendingWrites.add(pending);
    try {
    const epoch = this.epoch;
    const db = await this.database;
    if (epoch !== this.epoch) return;
    if (db) {
      if (this.renewTimer === undefined) {
        this.renewLease(db);
        this.renewTimer = setInterval(() => this.renewLease(db), 30_000);
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('segments', 'readwrite');
          const timeout = setTimeout(() => {
            try { tx.abort(); } catch { /* The browser may have already closed the transaction. */ }
            reject(new Error('Recording storage timed out'));
          }, 15_000);
          tx.oncomplete = () => { clearTimeout(timeout); resolve(); };
          tx.onerror = () => { clearTimeout(timeout); reject(tx.error); };
          tx.onabort = () => { clearTimeout(timeout); reject(tx.error); };
          try { tx.objectStore('segments').put({ id: segment.id, start: segment.start, end: segment.end, blob: segment.blob, owner: this.owner, expiresAt: segment.end + this.windowMs }); }
          catch (error) { clearTimeout(timeout); reject(error); }
        });
        segment.disk = true; segment.blob = undefined;
      } catch { this.warning = 'Device storage could not keep this recording. Replay history is shorter.'; }
    } else this.warning = 'Device storage is unavailable. Only recent replay video is kept.';
    if (epoch !== this.epoch) { if (segment.disk) await this.remove(segment); return; }
    this.segments.push(segment);
    this.segments.sort((a, b) => a.start - b.start);
    this.prune(Math.max(...this.segments.map((item) => item.end)));
    } finally { this.pendingBytes -= segment.size; this.pendingWrites.delete(pending); finished(); }
  }
  prune(now: number): void {
    let memory = this.segments.reduce((sum, segment) => sum + (segment.blob ? segment.size : 0), 0);
    let disk = this.segments.reduce((sum, segment) => sum + (segment.disk ? segment.size : 0), 0);
    for (const segment of [...this.segments]) {
      if (segment.pins > 0) continue;
      if (segment.end >= now - this.windowMs && memory <= this.memoryLimit && disk <= this.diskLimit) continue;
      if (memory > this.memoryLimit || disk > this.diskLimit) this.warning = 'Replay storage limit reached. Older video has been removed.';
      memory -= segment.blob ? segment.size : 0; disk -= segment.disk ? segment.size : 0;
      this.remove(segment);
    }
  }
  async read(segment: ReplaySegment): Promise<Blob> {
    if (segment.blob) return segment.blob;
    const db = await this.database;
    if (!db) throw new Error('This part of the replay is no longer available.');
    return new Promise((resolve, reject) => {
      const request = db.transaction('segments', 'readonly').objectStore('segments').get(segment.id);
      request.onsuccess = () => request.result?.blob ? resolve(request.result.blob) : reject(new Error('This part of the replay is no longer available.'));
      request.onerror = () => reject(new Error('Could not read the recording from device storage.'));
    });
  }
  private async remove(segment: ReplaySegment): Promise<void> {
    const index = this.segments.indexOf(segment);
    if (index >= 0) this.segments.splice(index, 1);
    if (segment.disk) await this.database.then((db) => { try { db?.transaction('segments', 'readwrite').objectStore('segments').delete(segment.id); } catch { /* Expiry cleanup also removes abandoned segments. */ } });
  }
  clear(): void { this.epoch++; for (const segment of [...this.segments]) this.remove(segment); }
  async dispose(): Promise<void> {
    this.disposed = true;
    clearInterval(this.renewTimer); this.renewTimer = undefined;
    this.clear();
    // Let bounded pending writes finish their stale-session deletion before closing the connection.
    await Promise.all([...this.pendingWrites]);
    const db = await this.database;
    try { db?.transaction('segments', 'readwrite').objectStore('segments').delete(this.owner); }
    catch { /* The bounded owner lease expires if storage has already closed. */ }
    db?.close();
  }
  get retainedSeconds(): number { return this.segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start) / 1000, 0); }
}
