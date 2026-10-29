import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ReplaySegmentStore, type ReplaySegment } from './replaySegments';

function database() {
  const values = new Map<string, { id: string; end?: number; blob?: Blob; owner?: string; expiresAt?: number; leaseUntil?: number }>();
  const state = { openError: false, blocked: false, throwOpen: false, quota: false, readError: false, deleteThrows: false, stalled: false, openStalled: false };
  const createObjectStore = vi.fn();
  function transaction() {
    const tx = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null, error: new Error('Storage quota'), abort: vi.fn(() => tx.onabort?.()), objectStore: () => ({
      put: (value: { id: string; end: number; blob: Blob }) => queueMicrotask(() => { if (state.stalled) return; if (state.quota) tx.onerror?.(); else { values.set(value.id, value); tx.oncomplete?.(); } }),
      delete: (id: string) => { if (state.deleteThrows) throw new Error('Storage closed'); values.delete(id); },
      get: (id: string) => {
        const request = { result: values.get(id), onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
        queueMicrotask(() => state.readError ? request.onerror?.() : request.onsuccess?.()); return request;
      },
      openCursor: () => {
        const entries = [...values.values()]; let index = 0;
        const request = { result: null as unknown, onsuccess: null as (() => void) | null };
        const advance = () => { const item = entries[index++]; request.result = item ? { value: item, delete: () => values.delete(item.id), continue: advance } : null; queueMicrotask(() => request.onsuccess?.()); };
        advance(); return request;
      },
    }) };
    return tx;
  }
  const db = { transaction, createObjectStore, close: vi.fn() };
  vi.stubGlobal('indexedDB', { open: () => {
    if (state.throwOpen) throw new Error('Blocked storage');
    const request = { result: db, onupgradeneeded: null as (() => void) | null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, onblocked: null as (() => void) | null };
    queueMicrotask(() => { if (state.openStalled) return; if (state.openError) request.onerror?.(); else if (state.blocked) request.onblocked?.(); else { request.onupgradeneeded?.(); request.onsuccess?.(); } }); return request;
  } });
  return { values, state, createObjectStore, close: db.close };
}
const segment = (id: string, start = 2000, end = 3000): ReplaySegment => ({ id, start, end, size: 3, blob: new Blob(['vid']), pins: 0 });
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(3000); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('writes complete recordings to disk, releases their RAM copies and reads them back', async () => {
  const db = database(); const store = new ReplaySegmentStore(1800_000); const item = segment('first'); const blob = item.blob;
  await store.add(item); expect(item.disk).toBe(true); expect(item.blob).toBeUndefined();
  expect(await store.read(item)).toBe(blob); expect(store.retainedSeconds).toBe(1); expect(db.createObjectStore).toHaveBeenCalled();
  store.clear(); await Promise.resolve(); expect(db.values.has('first')).toBe(false); await store.dispose(); expect(db.values.size).toBe(0);
});
it('evicts old disk recordings when its byte budget is reached', async () => {
  const db = database(); const store = new ReplaySegmentStore(60_000, 64, 4);
  await store.add(segment('first')); await store.add(segment('second', 3000, 4000)); await Promise.resolve();
  expect(store.segments.map((s) => s.id)).toEqual(['second']); expect(db.values.has('first')).toBe(false); expect(store.warning).toMatch(/limit/);
});
it('removes expired recordings left by a previous crashed session', async () => {
  const db = database(); db.values.set('abandoned', { id: 'abandoned', end: -86_400_000, blob: new Blob(['old']) });
  const store = new ReplaySegmentStore(1000); await store.add(segment('new')); expect(db.values.has('abandoned')).toBe(false);
});
it.each(['openError', 'blocked', 'throwOpen'] as const)('falls back to bounded RAM when opening storage fails: %s', async (failure) => {
  const db = database(); db.state[failure] = true; const store = new ReplaySegmentStore(1000); const item = segment('one');
  await store.add(item); expect(item.blob).toBeDefined(); expect(store.warning).toMatch(/unavailable/);
  expect(await store.read(item)).toBe(item.blob);
});
it('falls back on quota exhaustion and reports missing/failed disk reads', async () => {
  const db = database(); const store = new ReplaySegmentStore(60_000); db.state.quota = true;
  const item = segment('first'); await store.add(item); expect(store.warning).toMatch(/could not keep/); expect(item.blob).toBeDefined();
  db.state.quota = false; const second = segment('second'); await store.add(second); db.values.delete('second');
  await expect(store.read(second)).rejects.toThrow('no longer'); db.state.readError = true; await expect(store.read(second)).rejects.toThrow('read');
});
it('ignores recordings from a session cleared while the database was opening', async () => {
  database(); const store = new ReplaySegmentStore(1000); const adding = store.add(segment('old')); store.clear(); await adding;
  expect(store.segments).toEqual([]);
});
it('tolerates unavailable cleanup, leaving expiry cleanup to remove orphaned recordings', async () => {
  const db = database(); const store = new ReplaySegmentStore(1000); await store.add(segment('one')); db.state.deleteThrows = true;
  expect(() => store.clear()).not.toThrow(); await Promise.resolve();
});

it('removes temporary recordings and closes its connection on disposal', async () => {
  const db = database(); const store = new ReplaySegmentStore(1000); await store.add(segment('one'));
  await store.dispose(); expect(db.values.size).toBe(0); expect(db.close).toHaveBeenCalledOnce();
});

it('bounds pending storage writes and falls back when a transaction stalls', async () => {
  vi.useFakeTimers(); const db = database(); db.state.stalled = true; const store = new ReplaySegmentStore(1000, 4);
  const first = segment('one'); const writing = store.add(first); await Promise.resolve(); await Promise.resolve();
  await store.add(segment('two')); expect(store.warning).toMatch(/too slow/); expect(store.segments).toEqual([]);
  await vi.advanceTimersByTimeAsync(15001); await writing;
  expect(first.blob).toBeDefined(); expect(store.segments).toHaveLength(1); await store.dispose();
});
it('falls back to bounded memory when opening IndexedDB never finishes', async () => {
  vi.useFakeTimers(); const db = database(); db.state.openStalled = true; const store = new ReplaySegmentStore(1000);
  const writing = store.add(segment('one')); await vi.advanceTimersByTimeAsync(15001); await writing;
  expect(store.warning).toMatch(/unavailable/); expect(store.segments[0].blob).toBeDefined();
});

it('deletes a late completed write before closing on disposal', async () => {
  const values = new Map<string, unknown>(); let closed = false; let completeWrite: (() => void) | undefined;
  const close = vi.fn(() => { closed = true; });
  const db = { close, transaction: () => {
    if (closed) throw new Error('Database is closing');
    const tx = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null, objectStore: () => ({
      openCursor: () => ({ onsuccess: null, result: null }),
      put: (item: { id: string }) => { completeWrite = () => { values.set(item.id, item); tx.oncomplete?.(); }; },
      delete: (id: string) => values.delete(id),
    }) }; return tx;
  } };
  vi.stubGlobal('indexedDB', { open: () => { const request = { result: db, onsuccess: null as (() => void) | null }; queueMicrotask(() => request.onsuccess?.()); return request; } });
  const store = new ReplaySegmentStore(1000); const writing = store.add(segment('late'));
  await Promise.resolve(); await Promise.resolve();
  const disposing = store.dispose(); await Promise.resolve(); expect(close).not.toHaveBeenCalled();
  completeWrite!(); await writing; await disposing;
  expect(values.size).toBe(0); expect(close).toHaveBeenCalledOnce();
  await store.add(segment('after-disposal')); expect(store.segments).toEqual([]);
});

it('keeps another active owner history and pinned exports when a short viewer opens', async () => {
  vi.useFakeTimers(); vi.spyOn(Date, 'now').mockRestore(); vi.setSystemTime(1000);
  const db = database(); const controller = new ReplaySegmentStore(1800_000);
  const old = segment('controller', 1000, 2000); await controller.add(old); old.pins++;
  await vi.advanceTimersByTimeAsync(1802_000);
  const viewer = new ReplaySegmentStore(60_000); await viewer.add(segment('viewer', Date.now(), Date.now() + 1000));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(db.values.has('controller')).toBe(true); expect(await controller.read(old)).toBeInstanceOf(Blob);
  await viewer.dispose(); expect(db.values.has('controller')).toBe(true);
  old.pins--; controller.prune(Date.now()); await Promise.resolve(); expect(db.values.has('controller')).toBe(false);
  await controller.dispose();
});
it('expires abandoned records by their own deadline and removes expired owner leases', async () => {
  const db = database();
  db.values.set('owner:crashed', { id: 'owner:crashed', leaseUntil: 1000 });
  db.values.set('expired', { id: 'expired', end: 0, expiresAt: 2000, owner: 'owner:crashed', blob: new Blob(['old']) });
  db.values.set('long', { id: 'long', end: 0, expiresAt: 1800_000, owner: 'owner:crashed', blob: new Blob(['keep']) });
  const viewer = new ReplaySegmentStore(1000); await viewer.add(segment('new'));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(db.values.has('expired')).toBe(false); expect(db.values.has('owner:crashed')).toBe(false); expect(db.values.has('long')).toBe(true);
  await viewer.dispose();
});
it('orders late completed segments and prunes against the newest timestamp', async () => {
  database(); const store = new ReplaySegmentStore(1000);
  await store.add(segment('new', 4000, 5000)); await store.add(segment('late', 1000, 2000));
  expect(store.segments.map((item) => item.id)).toEqual(['new']); await store.dispose();
});

it('isolates retention from old tabs without deleting their recordings', async () => {
  database(); const open = vi.spyOn(indexedDB, 'open');
  const deleteDatabase = vi.fn();
  Object.defineProperty(indexedDB, 'deleteDatabase', { configurable: true, value: deleteDatabase });
  const store = new ReplaySegmentStore(60_000); await store.add(segment('current'));
  expect(open).toHaveBeenCalledWith('mg-replay-buffer-v2', 1);
  expect(deleteDatabase).not.toHaveBeenCalled();
  expect(store.segments).toHaveLength(1); await store.dispose();
});
