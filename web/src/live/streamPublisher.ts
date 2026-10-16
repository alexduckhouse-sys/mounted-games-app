import type { IceServer, LiveStream, PublishRequest, PublishResponse, UpdateStreamRequest } from '../types';
import { responseStatus, streamClock, streamRequest, type StreamClock } from './streamRuntime';

export type PublisherState = 'idle' | 'starting' | 'live' | 'paused' | 'reconnecting' | 'ended' | 'error';
export interface PublisherSnapshot {
  state: PublisherState;
  media: MediaStream | null;
  streamId: number | null;
  viewerCount: number;
  signal: 'good' | 'fair' | 'poor';
  audioMuted: boolean;
  hasAudio: boolean;
  error: string | null;
}
export interface PublisherDependencies extends StreamClock {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices: () => Promise<MediaDeviceInfo[]>;
  PeerConnection: typeof RTCPeerConnection;
  request: typeof streamRequest;
  wakeLock: () => Promise<{ release: () => Promise<void> }>;
  visibility: { hidden: () => boolean; listen: (callback: () => void) => () => void };
}
export function browserPublisherDependencies(): PublisherDependencies {
  return {
    ...streamClock, request: streamRequest, PeerConnection: RTCPeerConnection,
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    wakeLock: () => navigator.wakeLock.request('screen'),
    visibility: {
      hidden: () => document.hidden,
      listen: (callback) => {
        document.addEventListener('visibilitychange', callback);
        return () => document.removeEventListener('visibilitychange', callback);
      },
    },
  };
}
const encodings: RTCRtpEncodingParameters[] = [
  { rid: 'f', maxBitrate: 1_500_000 },
  { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 500_000 },
  { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 150_000 },
];

/** One operator-owned camera and publisher. No React or global browser state is used here. */
export function createStreamPublisher(competitionId: number, d: PublisherDependencies) {
  const base = `/competitions/${competitionId}/streams`;
  let snapshot: PublisherSnapshot = { state: 'idle', media: null, streamId: null, viewerCount: 0, signal: 'good', audioMuted: false, hasAudio: false, error: null };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<PublisherSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((fn) => fn()); };
  let pc: RTCPeerConnection | undefined;
  let videoSender: RTCRtpSender | undefined;
  let alive = true;
  let running = false;
  let busy = false;
  let pendingRecovery = false;
  let epoch = 0;
  let captureEpoch = 0;
  let failures = 0;
  let hadStream = false;
  let arenaName = '';
  let angleName = '';
  let paused = false;
  let caption: string | null = null;
  let facingMode = 'environment';
  let deviceId: string | undefined;
  let cancelRetry: (() => void) | undefined;
  let heartbeatEpoch = 0;
  let cancelHeartbeat: (() => void) | undefined;
  let cancelStats: (() => void) | undefined;
  let cancelDisconnect: (() => void) | undefined;
  let cancelConnect: (() => void) | undefined;
  let wake: { release: () => Promise<void> } | undefined;
  let hiddenAt: number | undefined;
  const releaseMedia = (media: MediaStream) => media.getTracks().forEach((track) => track.stop());
  const videoConstraints = (): MediaTrackConstraints => ({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode }) });
  function applyAudio() { snapshot.media?.getAudioTracks().forEach((track) => { track.enabled = !snapshot.audioMuted && !paused; }); }
  async function capture(sound = true) {
    const ticket = ++captureEpoch;
    const media = await d.getUserMedia({ video: videoConstraints(), audio: sound ? { echoCancellation: true, noiseSuppression: true } : false });
    if (!alive || ticket !== captureEpoch) { releaseMedia(media); return; }
    if (snapshot.media) releaseMedia(snapshot.media);
    update({ media, hasAudio: media.getAudioTracks().length > 0, audioMuted: !sound });
    applyAudio();
  }
  async function acquireWake() {
    try {
      const next = await d.wakeLock();
      if (!running || d.visibility.hidden()) { await next.release(); return; }
      const previous = wake;
      wake = next;
      if (previous) void previous.release().catch(() => { /* The replacement lock is already held. */ });
    } catch { /* Screen wake locks are optional, including in Safari. */ }
  }
  const unlisten = d.visibility.listen(() => {
    if (d.visibility.hidden()) { hiddenAt = d.now(); return; }
    if (!running) return;
    void acquireWake();
    if (hiddenAt !== undefined && d.now() - hiddenAt > 20_000) recover();
    hiddenAt = undefined;
  });
  function closePeer() {
    videoSender = undefined;
    cancelConnect?.(); cancelConnect = undefined;
    cancelDisconnect?.(); cancelDisconnect = undefined;
    cancelStats?.(); cancelStats = undefined;
    if (pc) { pc.onconnectionstatechange = null; pc.close(); pc = undefined; }
  }
  function retry() {
    if (!running || cancelRetry) return;
    update({ state: 'reconnecting', signal: 'poor' });
    cancelRetry = d.schedule(() => { cancelRetry = undefined; void publish(); }, Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)));
  }
  function recover() {
    if (!running) return;
    if (busy) { pendingRecovery = true; return; }
    cancelRetry?.(); cancelRetry = undefined;
    void publish();
  }
  function heartbeat() {
    const owner = ++heartbeatEpoch;
    const id = snapshot.streamId;
    cancelHeartbeat = d.schedule(() => {
      if (!running || owner !== heartbeatEpoch) return;
      void d.request('POST', `${base}/${id}/heartbeat`).catch((error: unknown) => {
        if (running && owner === heartbeatEpoch && snapshot.streamId === id && responseStatus(error) === 409) {
          update({ streamId: null }); recover();
        }
      }).finally(() => { if (running && owner === heartbeatEpoch) heartbeat(); });
    }, 15_000);
  }
  function monitor(peer: RTCPeerConnection) {
    let lastPackets = -1;
    let lastProgress = d.now();
    let lastBytes = 0;
    let lastAt = d.now();
    async function sample() {
      if (!running || pc !== peer) return;
      try {
        const stats = await peer.getStats();
        if (pc !== peer || !running) return;
        let packets = 0, bytes = 0;
        let limited = false;
        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            packets += report.packetsSent ?? 0;
            bytes += report.bytesSent ?? 0;
            limited ||= report.qualityLimitationReason === 'bandwidth' || report.qualityLimitationReason === 'cpu';
          }
        });
        const now = d.now();
        if (packets > lastPackets) { lastPackets = packets; lastProgress = now; }
        const bitrate = (bytes - lastBytes) * 8000 / Math.max(1, now - lastAt);
        update({ signal: bitrate < 150_000 ? 'poor' : limited || bitrate < 500_000 ? 'fair' : 'good' });
        lastBytes = bytes; lastAt = now;
        if (now - lastProgress >= 15_000) { recover(); return; }
      } catch { /* A transient stats failure must not end a broadcast. */ }
      if (running && pc === peer) cancelStats = d.schedule(() => { void sample(); }, 3000);
    }
    cancelStats = d.schedule(() => { void sample(); }, 3000);
  }
  async function publish() {
    if (!running || busy) return;
    busy = true;
    const ticket = epoch;
    const current = () => running && ticket === epoch;
    update({ state: snapshot.streamId === null && failures === 0 ? 'starting' : 'reconnecting', error: null });
    closePeer();
    heartbeatEpoch++; cancelHeartbeat?.(); cancelHeartbeat = undefined;
    try {
      if (!snapshot.media || snapshot.media.getTracks().some((track) => track.readyState === 'ended')) {
        const muted = snapshot.audioMuted;
        await capture(snapshot.hasAudio);
        update({ audioMuted: muted }); applyAudio();
      }
      if (!current()) return;
      const { iceServers } = await d.request<{ iceServers: IceServer[] }>('GET', `${base}/ice-servers`);
      if (!current()) return;
      const peer = new d.PeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
      pc = peer;
      const media = snapshot.media!;
      let video: RTCRtpTransceiver;
      try { video = peer.addTransceiver(media.getVideoTracks()[0], { direction: 'sendonly', streams: [media], sendEncodings: encodings }); }
      catch { video = peer.addTransceiver(media.getVideoTracks()[0], { direction: 'sendonly', streams: [media] }); }
      videoSender = video.sender;
      const audioTrack = media.getAudioTracks()[0];
      const audio = audioTrack ? peer.addTransceiver(audioTrack, { direction: 'sendonly', streams: [media] }) : undefined;
      await peer.setLocalDescription(await peer.createOffer());
      if (!current()) return;
      const body: PublishRequest = { sdpOffer: peer.localDescription!.sdp, videoMid: video.mid!, audioMid: audio?.mid };
      let result: PublishResponse;
      try {
        result = snapshot.streamId === null
          ? await d.request<PublishResponse>('POST', base, { ...body, arenaName, angleName, takeOver: hadStream })
          : await d.request<PublishResponse>('POST', `${base}/${snapshot.streamId}/republish`, body);
      } catch (error) {
        if (responseStatus(error) !== 409 || snapshot.streamId === null) throw error;
        result = await d.request<PublishResponse>('POST', base, { ...body, arenaName, angleName, takeOver: true });
      }
      if (!current()) { void d.request('POST', `${base}/${result.streamId}/end`).catch(() => {}); return; }
      hadStream = true;
      update({ streamId: result.streamId });
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdpAnswer });
      if (!current()) return;
      await new Promise<void>((resolve, reject) => {
        const cancelTimeout = d.schedule(() => reject(new Error('Connection timed out')), 15_000);
        cancelConnect = () => { cancelTimeout(); reject(new Error('Cancelled')); };
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === 'connected') { cancelTimeout(); resolve(); }
          else if (peer.connectionState === 'failed') { cancelTimeout(); reject(new Error('Connection failed')); }
        };
        peer.onconnectionstatechange(new Event('connectionstatechange'));
      });
      cancelConnect = undefined;
      if (!current()) return;
      await d.request<LiveStream>('POST', `${base}/${result.streamId}/ready`, { attempt: result.attempt });
      if (!current()) return;
      // A replacement row starts Live; carry the operator's settings across the takeover.
      await d.request('PATCH', `${base}/${result.streamId}`, { status: paused ? 1 : 0, audioMuted: snapshot.audioMuted, caption });
      if (!current()) return;
      failures = 0;
      update({ state: paused ? 'paused' : 'live' });
      peer.onconnectionstatechange = () => {
        cancelDisconnect?.(); cancelDisconnect = undefined;
        if (peer.connectionState === 'failed') recover();
        else if (peer.connectionState === 'disconnected') cancelDisconnect = d.schedule(recover, 5000);
      };
      heartbeat(); monitor(peer);
      void acquireWake();
    } catch (error) {
      if (current()) {
        closePeer();
        const status = responseStatus(error);
        if (status === 401 || status === 403 || status === 404 || status === 400 || status === 503 || (status === 409 && !hadStream)) {
          running = false;
          update({ state: 'error', error: 'Could not start the stream. Check access and try again.' });
        } else retry();
      }
    } finally {
      busy = false;
      if (pendingRecovery && running) { pendingRecovery = false; recover(); }
    }
  }
  async function patch(body: UpdateStreamRequest) {
    if (snapshot.streamId === null) return;
    await d.request('PATCH', `${base}/${snapshot.streamId}`, body);
  }
  async function stop() {
    running = false; epoch++; captureEpoch++; heartbeatEpoch++;
    cancelRetry?.(); cancelRetry = undefined;
    cancelHeartbeat?.(); cancelHeartbeat = undefined;
    closePeer();
    if (snapshot.media) releaseMedia(snapshot.media);
    if (wake) { void wake.release().catch(() => {}); wake = undefined; }
    const id = snapshot.streamId;
    update({ state: 'ended', media: null, streamId: null });
    if (id !== null) await d.request('POST', `${base}/${id}/end`);
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    capture,
    devices: async () => (await d.enumerateDevices()).filter((device) => device.kind === 'videoinput'),
    async start(arena: string, angle: string) {
      if (running || busy || !alive) return;
      arenaName = arena.trim(); angleName = angle.trim(); running = true; epoch++;
      await publish();
    },
    async switchCamera(id?: string) {
      deviceId = id;
      if (!id) facingMode = facingMode === 'environment' ? 'user' : 'environment';
      const ticket = ++captureEpoch;
      const media = await d.getUserMedia({ video: videoConstraints(), audio: false });
      if (!alive || ticket !== captureEpoch) { releaseMedia(media); return; }
      const track = media.getVideoTracks()[0];
      try { await videoSender?.replaceTrack(track); }
      catch (error) { releaseMedia(media); throw error; }
      if (!alive || ticket !== captureEpoch) { releaseMedia(media); return; }
      const preview = snapshot.media!;
      preview.getVideoTracks().forEach((old) => { preview.removeTrack(old); old.stop(); });
      preview.addTrack(track);
      update({ media: preview });
    },
    async mute(muted: boolean) {
      if (!muted && !snapshot.hasAudio && snapshot.media) {
        const ticket = epoch;
        const audio = await d.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true } });
        if (!alive || ticket !== epoch) { releaseMedia(audio); return; }
        audio.getAudioTracks().forEach((track) => snapshot.media!.addTrack(track));
        update({ hasAudio: true, audioMuted: false }); applyAudio(); recover();
        return;
      }
      await patch({ audioMuted: muted }); update({ audioMuted: muted }); applyAudio();
    },
    async pause(value: boolean) { await patch({ status: value ? 1 : 0 }); paused = value; applyAudio(); update({ state: value ? 'paused' : 'live' }); },
    async caption(value: string) { await patch({ caption: value }); caption = value || null; },
    viewers(count: number) { update({ viewerCount: count }); },
    stop,
    dispose() { alive = false; unlisten(); void stop().catch(() => {}); listeners.clear(); },
  };
}
