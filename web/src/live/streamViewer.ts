import type { IceServer } from '../types';
import { streamClock, type StreamClock, type StreamInvoke } from './streamRuntime';

export interface ViewerSnapshot { media: MediaStream | null; state: 'connecting' | 'playing' | 'reconnecting' | 'error'; message: string | null }
export interface ViewerDependencies extends StreamClock {
  invoke: StreamInvoke;
  PeerConnection: typeof RTCPeerConnection;
  MediaStream: typeof MediaStream;
}
export function browserViewerDependencies(invoke: StreamInvoke): ViewerDependencies {
  return { ...streamClock, invoke, PeerConnection: RTCPeerConnection, MediaStream };
}
export const streamErrors = {
  STREAM_NOT_FOUND: 'This stream has finished.',
  STREAM_FULL: 'This stream is full. Try again shortly.',
  RATE_LIMITED: 'Please wait a moment. Trying again.',
  WATCH_EXPIRED: 'The connection expired. Trying again.',
  UPSTREAM_UNAVAILABLE: 'The video is unavailable. Trying again.',
  INVALID_REQUEST: 'Could not open this stream.',
};
export function streamErrorCode(error: unknown): keyof typeof streamErrors | null {
  const match = String(error).match(/\b(STREAM_NOT_FOUND|STREAM_FULL|RATE_LIMITED|WATCH_EXPIRED|UPSTREAM_UNAVAILABLE|INVALID_REQUEST):/);
  return match ? match[1] as keyof typeof streamErrors : null;
}

// One hub has only one server watch per stream. Serialise replacements across component
// instances as well, so StrictMode or A→B→A cannot let an old watch replace the new one.
interface WatchLease { owner: object; tail: Promise<void> }
const watches = new WeakMap<StreamInvoke, Map<string, WatchLease>>();

/** Uses the competition's existing hub. Each new watch invalidates all earlier asynchronous work. */
export function createStreamViewer(competitionId: number, streamId: number, d: ViewerDependencies) {
  let group = watches.get(d.invoke);
  if (!group) { group = new Map(); watches.set(d.invoke, group); }
  const key = `${competitionId}/${streamId}`;
  const owner = {};
  const lease = group.get(key) ?? { owner, tail: Promise.resolve() };
  lease.owner = owner; group.set(key, lease);
  let snapshot: ViewerSnapshot = { media: null, state: 'connecting', message: null };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ViewerSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((fn) => fn()); };
  let disposed = false;
  let epoch = 0;
  let generation = 0;
  let ready = -1;
  let failures = 0;
  let pc: RTCPeerConnection | undefined;
  let cancelRetry: (() => void) | undefined;
  let cancelStats: (() => void) | undefined;
  // Serialise WatchStream calls: an older call must not replace a newer server-side session.
  let watching = false;
  let pending = false;
  function close() {
    cancelStats?.(); cancelStats = undefined;
    if (pc) { pc.ontrack = null; pc.oniceconnectionstatechange = null; pc.close(); pc = undefined; }
  }
  function retry() {
    if (disposed || cancelRetry) return;
    cancelRetry = d.schedule(() => { cancelRetry = undefined; void watch(); }, Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)));
  }
  function monitor(peer: RTCPeerConnection) {
    let lastFrames = 0;
    let lastProgress = d.now();
    async function sample() {
      try {
        const stats = await peer.getStats();
        if (disposed || peer !== pc) return;
        let frames = 0;
        stats.forEach((report) => { if (report.type === 'inbound-rtp' && report.kind === 'video') frames += report.framesDecoded ?? 0; });
        if (frames > lastFrames) { lastFrames = frames; lastProgress = d.now(); failures = 0; update({ state: 'playing', message: null }); }
        const stalled = d.now() - lastProgress;
        if (stalled >= 20_000) { refresh(); return; }
        if (stalled >= 10_000) update({ state: 'reconnecting' });
      } catch { /* A closed peer can reject its final stats request. */ }
      if (!disposed && pc === peer) cancelStats = d.schedule(() => { void sample(); }, 2000);
    }
    cancelStats = d.schedule(() => { void sample(); }, 2000);
  }
  async function watch() {
    if (disposed || lease.owner !== owner) return;
    if (watching) { pending = true; return; }
    watching = true;
    const ticket = ++epoch;
    const current = () => !disposed && ticket === epoch && lease.owner === owner;
    const previous = lease.tail;
    let release!: () => void;
    lease.tail = new Promise<void>((resolve) => { release = resolve; });
    close();
    update({ state: snapshot.media ? 'reconnecting' : 'connecting', message: null });
    try {
      await previous;
      if (!current()) return;
      const result = await d.invoke<{ watchId: string; sdpOffer: string; generation: number; iceServers: IceServer[] }>('WatchStream', competitionId, streamId);
      if (!current()) return;
      generation = Math.max(generation, result.generation);
      const peer = new d.PeerConnection({ iceServers: result.iceServers, bundlePolicy: 'max-bundle' });
      pc = peer;
      const media = new d.MediaStream();
      peer.ontrack = (event) => {
        if (!current()) return;
        media.addTrack(event.track);
        update({ media });
      };
      peer.oniceconnectionstatechange = () => { if (peer.iceConnectionState === 'failed') refresh(); };
      await peer.setRemoteDescription({ type: 'offer', sdp: result.sdpOffer });
      if (!current()) return;
      await peer.setLocalDescription(await peer.createAnswer());
      if (!current()) return;
      await d.invoke('AnswerStream', result.watchId, peer.localDescription!.sdp);
      if (!current()) return;
      monitor(peer);
    } catch (error) {
      if (!current()) return;
      close();
      const code = streamErrorCode(error);
      update({ state: 'error', message: code ? streamErrors[code] : 'Could not connect. Trying again.' });
      if (code !== 'STREAM_NOT_FOUND' && code !== 'INVALID_REQUEST') retry();
    } finally {
      watching = false;
      if (disposed && lease.owner === owner) {
        // A WatchStream that completed after disposal may have allocated a fresh server session.
        await d.invoke('StopWatching', streamId).catch(() => {});
      }
      release();
      if (!disposed && pending) { pending = false; void watch(); }
    }
  }
  function refresh() {
    if (disposed) return;
    epoch++;
    cancelRetry?.(); cancelRetry = undefined;
    close();
    void watch();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    sync(nextReady: number, nextGeneration: number) {
      if (nextReady !== ready || nextGeneration > generation) {
        ready = nextReady; generation = nextGeneration; refresh();
      }
    },
    dispose() {
      disposed = true; epoch++;
      cancelRetry?.(); close();
      if (lease.owner === owner && !watching) void d.invoke('StopWatching', streamId).catch(() => {});
      listeners.clear();
    },
  };
}
