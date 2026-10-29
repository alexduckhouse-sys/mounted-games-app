import type { IceServer, LiveStream, PublishRequest, PublishResponse, StreamQualityPreset, UpdateStreamRequest } from '../types';
import { responseStatus, responseTitle, streamClock, streamRequest, type StreamClock } from './streamRuntime';

export type { StreamQualityPreset } from '../types';
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
  zoom?: number;
  maxZoom?: number;
  windFilter?: boolean;
  audioLevel?: number;
  fps?: number;
  bitrateKbps?: number;
  rttMs?: number;
  qualityPreset?: StreamQualityPreset;
  captureResolution?: string;
  /** The camera settings this camera can hold still: a key is present only when the camera supports it; true means held. */
  cameraLocks?: CameraLocks;
}
export type CameraLockKind = 'exposure' | 'focus' | 'whiteBalance';
export type CameraLocks = Partial<Record<CameraLockKind, boolean>>;
const LOCK_MODES: Record<CameraLockKind, 'exposureMode' | 'focusMode' | 'whiteBalanceMode'> = {
  exposure: 'exposureMode', focus: 'focusMode', whiteBalance: 'whiteBalanceMode',
};
type ModeTrack = {
  getCapabilities?: () => Record<string, unknown>;
  getSettings?: () => Record<string, unknown>;
  applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
};
/** The mode that holds a setting still: manual where offered, else a single adjustment that then stays. */
function lockMode(track: MediaStreamTrack | undefined, kind: CameraLockKind): string | null {
  const modes = (track as unknown as ModeTrack | undefined)?.getCapabilities?.()?.[LOCK_MODES[kind]];
  if (!Array.isArray(modes) || !modes.includes('continuous')) return null;
  return modes.includes('manual') ? 'manual' : modes.includes('single-shot') ? 'single-shot' : null;
}
/** Which settings the camera can lock (most iPhones report none), and whether each is locked now. */
export function detectCameraLocks(track?: MediaStreamTrack): CameraLocks {
  const locks: CameraLocks = {};
  const settings = (track as unknown as ModeTrack | undefined)?.getSettings?.();
  for (const kind of Object.keys(LOCK_MODES) as CameraLockKind[]) {
    if (!lockMode(track, kind)) continue;
    const mode = settings?.[LOCK_MODES[kind]];
    locks[kind] = typeof mode === 'string' && mode !== 'continuous';
  }
  return locks;
}
export interface PublisherDependencies extends StreamClock {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices: () => Promise<MediaDeviceInfo[]>;
  PeerConnection: typeof RTCPeerConnection;
  request: typeof streamRequest;
  wakeLock: () => Promise<{ release: () => Promise<void> }>;
  visibility: { hidden: () => boolean; listen: (callback: () => void) => () => void };
  /** Calls back when a camera or microphone is plugged in or removed. Optional: without it the lists only refresh on request. */
  deviceChanges?: (callback: () => void) => () => void;
}
export function browserPublisherDependencies(customRequest: typeof streamRequest = streamRequest): PublisherDependencies {
  return {
    ...streamClock, request: customRequest, PeerConnection: RTCPeerConnection,
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
    deviceChanges: (callback) => {
      const devices = navigator.mediaDevices;
      if (typeof devices?.addEventListener !== 'function') return () => {};
      devices.addEventListener('devicechange', callback);
      return () => devices.removeEventListener('devicechange', callback);
    },
  };
}
const presetHeight = (preset: StreamQualityPreset): number => preset === 'auto' ? 1080 : Number.parseInt(preset, 10);

/** Keep the advertised layers bounded even when a camera ignores its ideal capture size. */
function senderEncoding(track: MediaStreamTrack | undefined, preset: StreamQualityPreset, rid?: string): RTCRtpEncodingParameters {
  const fullHeight = presetHeight(preset);
  const height = rid === 'q' ? Math.min(fullHeight, 360) : rid === 'h' ? Math.min(fullHeight, 540) : fullHeight;
  const settings = track?.getSettings?.();
  // Portrait cameras report width/height swapped. Resolution presets describe the shorter edge.
  const dimensions = [settings?.width, settings?.height].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const sourceHeight = dimensions.length ? Math.min(...dimensions) : fullHeight;
  const maxBitrate = height <= 360 ? 350_000 : height <= 480 ? 900_000 : height <= 540 ? 850_000 : height <= 720 ? 1_500_000 : preset === 'auto' ? 2_200_000 : 2_500_000;
  return { ...(rid ? { rid } : {}), maxBitrate, maxFramerate: 30, scaleResolutionDownBy: Math.max(1, sourceHeight / height) };
}

function detectResolutionLabel(track?: MediaStreamTrack): string {
  const settings = (track as MediaStreamTrack & { getSettings?: () => MediaTrackSettings })?.getSettings?.();
  const dimensions = [settings?.width, settings?.height].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const h = dimensions.length ? Math.min(...dimensions) : 720;
  if (h >= 2000) return '4K';
  if (h >= 1400) return '1440p';
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 470) return '480p';
  return '360p';
}

function detectMaxZoom(track?: MediaStreamTrack): number {
  const caps = (track as unknown as { getCapabilities?: () => { zoom?: { max?: number } } })?.getCapabilities?.();
  const max = caps?.zoom?.max;
  return typeof max === 'number' && max > 1 ? Math.min(max, 6) : 3;
}

/** One operator-owned camera and publisher. No React or global browser state is used here. */
export function createStreamPublisher(competitionId: number, d: PublisherDependencies) {
  const base = `/competitions/${competitionId}/streams`;
  let snapshot: PublisherSnapshot = {
    state: 'idle', media: null, streamId: null, viewerCount: 0, signal: 'good',
    audioMuted: false, hasAudio: false, error: null,
    zoom: 1, maxZoom: 3, windFilter: true, audioLevel: 0, fps: 30, bitrateKbps: 0, rttMs: 0,
    qualityPreset: '720p', captureResolution: '1080p',
  };
  const listeners = new Set<() => void>();
  const deviceWatchers = new Set<() => void>();
  const update = (patch: Partial<PublisherSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((fn) => fn()); };
  let pc: RTCPeerConnection | undefined;
  let videoSender: RTCRtpSender | undefined;
  let audioSender: RTCRtpSender | undefined;
  let alive = true;
  let running = false;
  let busy = false;
  let pendingRecovery = false;
  let epoch = 0;
  let captureEpoch = 0;
  let qualityChange: Promise<void> = Promise.resolve();
  let failures = 0;
  let hadStream = false;
  let takeOverFirst = false;
  let arenaName = '';
  let angleName = '';
  let paused = false;
  let pauseRevision = 0;
  let caption: string | null = null;
  let facingMode = 'environment';
  let deviceId: string | undefined;
  let audioDeviceId: string | undefined;
  let windFilterEnabled = true;
  let cancelRetry: (() => void) | undefined;
  let heartbeatEpoch = 0;
  let cancelHeartbeat: (() => void) | undefined;
  let cancelStats: (() => void) | undefined;
  let cancelDisconnect: (() => void) | undefined;
  let cancelConnect: (() => void) | undefined;
  let wake: { release: () => Promise<void> } | undefined;
  let hiddenAt: number | undefined;
  const releaseMedia = (media: MediaStream) => media.getTracks().forEach((track) => track.stop());
  const videoConstraints = (idealHeight = presetHeight(snapshot.qualityPreset ?? '720p')): MediaTrackConstraints => ({
    width: { ideal: Math.round(idealHeight * 16 / 9) }, height: { ideal: idealHeight }, frameRate: { ideal: 30 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode }),
  });
  const audioConstraints = (): MediaTrackConstraints => ({
    echoCancellation: true, noiseSuppression: true,
    ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
  });
  function applyAudio() { snapshot.media?.getAudioTracks().forEach((track) => { track.enabled = !snapshot.audioMuted && !paused; }); }
  function prepareVideoTrack(track?: MediaStreamTrack) {
    if (!track) return;
    try { if ('contentHint' in track || typeof track === 'object') (track as MediaStreamTrack & { contentHint?: string }).contentHint = 'motion'; } catch { /* ignore */ }
  }
  async function applySenderParameters(preset: StreamQualityPreset = snapshot.qualityPreset ?? '720p') {
    const sender = videoSender as (RTCRtpSender & {
      getParameters?: () => RTCRtpSendParameters;
      setParameters?: (p: RTCRtpSendParameters) => Promise<void>;
    }) | undefined;
    if (!sender?.getParameters || !sender?.setParameters) return;
    try {
      const params = sender.getParameters() ?? ({ encodings: [] } as unknown as RTCRtpSendParameters);
      (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'maintain-framerate';
      if (Array.isArray(params.encodings) && params.encodings.length > 0) {
        for (const enc of params.encodings) {
          Object.assign(enc, senderEncoding(snapshot.media?.getVideoTracks()[0], preset, enc.rid));
        }
      }
      await sender.setParameters(params);
    } catch { /* Browser may reject runtime encoding parameter edits. */ }
  }
  async function reconcileCapture(media: MediaStream, requested: StreamQualityPreset | undefined) {
    // Permission/device selection can outlast a quality change made while capture is pending.
    while (alive && snapshot.qualityPreset !== requested) {
      requested = snapshot.qualityPreset;
      try { await media.getVideoTracks()[0]?.applyConstraints?.(videoConstraints()); }
      catch { break; /* The sender will still scale a camera that cannot change its capture size. */ }
    }
  }
  async function capture(sound = true) {
    const ticket = ++captureEpoch;
    const requestedPreset = snapshot.qualityPreset;
    let media: MediaStream;
    try {
      media = await d.getUserMedia({ video: videoConstraints(), audio: sound ? audioConstraints() : false });
    } catch {
      media = await d.getUserMedia({ video: videoConstraints(720), audio: sound ? audioConstraints() : false });
    }
    if (!alive || ticket !== captureEpoch) { releaseMedia(media); return; }
    await reconcileCapture(media, requestedPreset);
    if (!alive || ticket !== captureEpoch) { releaseMedia(media); return; }
    if (snapshot.media) releaseMedia(snapshot.media);
    const vTrack = media.getVideoTracks()[0];
    prepareVideoTrack(vTrack);
    update({
      media,
      hasAudio: media.getAudioTracks().length > 0,
      audioMuted: !sound,
      zoom: 1,
      maxZoom: detectMaxZoom(vTrack),
      captureResolution: detectResolutionLabel(vTrack),
      cameraLocks: detectCameraLocks(vTrack),
    });
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
    const trackEnded = snapshot.media?.getTracks().some((t) => t.readyState === 'ended') ?? false;
    const peerBroken = pc?.connectionState === 'failed' || pc?.connectionState === 'disconnected';
    if (trackEnded || peerBroken || (hiddenAt !== undefined && d.now() - hiddenAt > 20_000)) recover();
    hiddenAt = undefined;
  });
  function closePeer() {
    videoSender = undefined;
    audioSender = undefined;
    cancelConnect?.(); cancelConnect = undefined;
    cancelDisconnect?.(); cancelDisconnect = undefined;
    cancelStats?.(); cancelStats = undefined;
    if (pc) { pc.onconnectionstatechange = null; pc.oniceconnectionstatechange = null; pc.close(); pc = undefined; }
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
      void d.request('POST', `${base}/${id}/heartbeat`, {
        audioMuted: snapshot.audioMuted,
        zoom: snapshot.zoom,
        maxZoom: snapshot.maxZoom,
        fps: snapshot.fps,
        bitrateKbps: snapshot.bitrateKbps,
        signal: snapshot.signal,
        windFilter: snapshot.windFilter,
        qualityPreset: snapshot.qualityPreset,
        captureResolution: snapshot.captureResolution,
      }).catch((error: unknown) => {
        const status = responseStatus(error);
        if (running && owner === heartbeatEpoch && snapshot.streamId === id && (status === 409 || status === 404)) {
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
        let packets = 0, bytes = 0, fps = snapshot.fps ?? 30, rttMs = snapshot.rttMs ?? 0;
        let limited = false;
        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            packets += report.packetsSent ?? 0;
            bytes += report.bytesSent ?? 0;
            if (typeof report.framesPerSecond === 'number') fps = Math.round(report.framesPerSecond);
            limited ||= report.qualityLimitationReason === 'bandwidth' || report.qualityLimitationReason === 'cpu';
          } else if (report.type === 'candidate-pair' && report.state === 'succeeded' && typeof report.currentRoundTripTime === 'number') {
            rttMs = Math.round(report.currentRoundTripTime * 1000);
            if (report.currentRoundTripTime > 0.4) limited = true;
          }
        });
        const now = d.now();
        if (packets > lastPackets) { lastPackets = packets; lastProgress = now; }
        const bitrate = (bytes - lastBytes) * 8000 / Math.max(1, now - lastAt);
        update({
          signal: bitrate < 150_000 ? 'poor' : limited || bitrate < 500_000 ? 'fair' : 'good',
          fps,
          bitrateKbps: Math.max(0, Math.round(bitrate / 1000)),
          rttMs,
        });
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
      const vTrack = media.getVideoTracks()[0];
      prepareVideoTrack(vTrack);
      let video: RTCRtpTransceiver;
      try { video = peer.addTransceiver(vTrack, { direction: 'sendonly', streams: [media], sendEncodings: ['f', 'h', 'q'].map((rid) => senderEncoding(vTrack, snapshot.qualityPreset ?? '720p', rid)) }); }
      catch { video = peer.addTransceiver(vTrack, { direction: 'sendonly', streams: [media] }); }
      videoSender = video.sender;
      await applySenderParameters(snapshot.qualityPreset);
      if (!current() || pc !== peer) return;
      const audioTrack = media.getAudioTracks()[0];
      const audio = audioTrack ? peer.addTransceiver(audioTrack, { direction: 'sendonly', streams: [media] }) : undefined;
      audioSender = audio?.sender;
      await peer.setLocalDescription(await peer.createOffer());
      if (!current()) return;
      const body: PublishRequest = { sdpOffer: peer.localDescription!.sdp, videoMid: video.mid!, audioMid: audio?.mid };
      // Only the operator's explicit choice takes over another camera. Recovery never does, or two
      // open studios on the same arena and angle would keep ending each other's stream.
      const create = () => d.request<PublishResponse>('POST', base, { ...body, arenaName, angleName, takeOver: !hadStream && takeOverFirst });
      let result: PublishResponse;
      try {
        result = snapshot.streamId === null ? await create()
          : await d.request<PublishResponse>('POST', `${base}/${snapshot.streamId}/republish`, body);
      } catch (error) {
        // 409: our stream was ended (the sweeper, an admin or another camera). 404: its starting row expired.
        const status = responseStatus(error);
        if ((status !== 409 && status !== 404) || snapshot.streamId === null) throw error;
        update({ streamId: null });
        result = await create();
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
      peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'failed') recover();
      };
      heartbeat(); monitor(peer);
      void acquireWake();
    } catch (error) {
      if (current()) {
        closePeer();
        const status = responseStatus(error);
        if (status === 409) {
          // The angle is taken (or the event is at its stream limit). Stop rather than fight for it;
          // the setup screen offers to take over.
          running = false;
          update({ state: 'error', streamId: null, error: hadStream
            ? `Another camera is now live on ${arenaName} · ${angleName}. Your stream has stopped.`
            : responseTitle(error) ?? 'Could not start the stream.' });
        } else if (status === 401 || status === 403 || status === 404 || status === 400 || status === 503) {
          running = false;
          update({ state: 'error', streamId: null, error: 'Could not start the stream. Check access and try again.' });
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
    audioDevices: async () => (await d.enumerateDevices()).filter((device) => device.kind === 'audioinput'),
    /**
     * Calls `listener` with fresh camera and microphone lists whenever one is plugged in or removed, so pickers
     * stay current. Returns the function that stops listening; disposing the publisher stops it too.
     */
    watchDevices(listener: (cameras: MediaDeviceInfo[], microphones: MediaDeviceInfo[]) => void): () => void {
      if (!d.deviceChanges) return () => {};
      let active = true;
      let stopListening = () => {};
      const unwatch = () => { if (!active) return; active = false; deviceWatchers.delete(unwatch); stopListening(); };
      deviceWatchers.add(unwatch);
      stopListening = d.deviceChanges(() => {
        void d.enumerateDevices().then((all) => {
          if (!active || !alive) return;
          listener(all.filter((device) => device.kind === 'videoinput'), all.filter((device) => device.kind === 'audioinput'));
        }).catch(() => { /* The lists stay as they were; the next change tries again. */ });
      });
      return unwatch;
    },
    /** Holds exposure, focus or white balance still (or lets the camera adjust again) where the camera supports it. */
    async setCameraLock(kind: CameraLockKind, locked: boolean) {
      const video = snapshot.media?.getVideoTracks()[0];
      const track = video as unknown as ModeTrack | undefined;
      const mode = lockMode(video, kind);
      if (!track?.applyConstraints || !mode) return;
      await track.applyConstraints({ advanced: [{ [LOCK_MODES[kind]]: locked ? mode : 'continuous' } as MediaTrackConstraintSet] });
      if (snapshot.media?.getVideoTracks()[0] !== video) return;
      update({ cameraLocks: { ...snapshot.cameraLocks, [kind]: locked } });
    },
    /** takeOver replaces a stream already live on the same arena and camera position. */
    async start(arena: string, angle: string, takeOver = false) {
      if (running || busy || !alive) return;
      arenaName = arena.trim(); angleName = angle.trim(); takeOverFirst = takeOver;
      hadStream = false; failures = 0; update({ streamId: null, error: null });
      running = true; epoch++;
      await publish();
    },
    async switchCamera(id?: string) {
      deviceId = id;
      if (!id) facingMode = facingMode === 'environment' ? 'user' : 'environment';
      const ticket = ++captureEpoch;
      const requestedPreset = snapshot.qualityPreset;
      const media = await d.getUserMedia({ video: videoConstraints(), audio: false });
      if (!alive || ticket !== captureEpoch) { releaseMedia(media); return; }
      await reconcileCapture(media, requestedPreset);
      if (!alive || ticket !== captureEpoch) { releaseMedia(media); return; }
      const track = media.getVideoTracks()[0];
      prepareVideoTrack(track);
      try { await videoSender?.replaceTrack(track); }
      catch (error) { releaseMedia(media); throw error; }
      if (!alive || ticket !== captureEpoch) { releaseMedia(media); return; }
      const preview = snapshot.media!;
      preview.getVideoTracks().forEach((old) => { preview.removeTrack(old); old.stop(); });
      preview.addTrack(track);
      update({ media: preview, zoom: 1, maxZoom: detectMaxZoom(track), captureResolution: detectResolutionLabel(track), cameraLocks: detectCameraLocks(track) });
      await applySenderParameters();
    },
    async switchAudio(id?: string) {
      audioDeviceId = id;
      if (!snapshot.media) return;
      const ticket = ++captureEpoch;
      const media = await d.getUserMedia({ video: false, audio: audioConstraints() });
      if (!alive || ticket !== captureEpoch) { releaseMedia(media); return; }
      const track = media.getAudioTracks()[0];
      if (!track) { releaseMedia(media); return; }
      try { await audioSender?.replaceTrack(track); }
      catch (error) { releaseMedia(media); throw error; }
      if (!alive || ticket !== captureEpoch || !snapshot.media) { releaseMedia(media); return; }
      const preview = snapshot.media;
      preview.getAudioTracks().forEach((old) => { preview.removeTrack(old); old.stop(); });
      preview.addTrack(track);
      update({ media: preview, hasAudio: true });
      applyAudio();
    },
    setWindFilter(enabled: boolean) {
      windFilterEnabled = enabled;
      update({ windFilter: windFilterEnabled });
    },
    async setZoom(zoom: number) {
      const clamped = Math.max(0.5, Math.min(snapshot.maxZoom ?? 3, zoom));
      update({ zoom: clamped });
      const track = snapshot.media?.getVideoTracks()[0] as (MediaStreamTrack & {
        applyConstraints?: (c: MediaTrackConstraints) => Promise<void>;
      }) | undefined;
      try {
        await track?.applyConstraints?.({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] });
      } catch { /* Hardware zoom constraints are optional across mobile browsers. */ }
    },
    async setQualityPreset(preset: StreamQualityPreset) {
      update({ qualityPreset: preset });
      // Serialise camera constraints so an earlier slow change cannot override the latest selection.
      qualityChange = qualityChange.then(async () => {
        if (!alive || snapshot.qualityPreset !== preset) return;
        const track = snapshot.media?.getVideoTracks()[0];
        try { await track?.applyConstraints?.(videoConstraints()); }
        catch { /* Keep a working camera; sender scaling still caps an unsupported capture size. */ }
        if (!alive || snapshot.media?.getVideoTracks()[0] !== track) return;
        if (track) update({ captureResolution: detectResolutionLabel(track) });
        await applySenderParameters();
      });
      await qualityChange;
    },
    async mute(muted: boolean) {
      if (!muted && !snapshot.hasAudio && snapshot.media) {
        const ticket = epoch;
        const audio = await d.getUserMedia({ video: false, audio: audioConstraints() });
        if (!alive || ticket !== epoch) { releaseMedia(audio); return; }
        audio.getAudioTracks().forEach((track) => snapshot.media!.addTrack(track));
        update({ hasAudio: true, audioMuted: false }); applyAudio(); recover();
        return;
      }
      // Privacy invariant: muting the microphone disables the track locally immediately and never
      // re-enables it if the network PATCH drops on spotty 4G; the next heartbeat syncs the server.
      update({ audioMuted: muted }); applyAudio();
      await patch({ audioMuted: muted });
    },
    async pause(value: boolean) {
      const previous = paused;
      const ticket = epoch, streamId = snapshot.streamId, peer = pc, revision = ++pauseRevision;
      paused = value; applyAudio(); update({ state: value ? 'paused' : 'live' });
      try { await patch({ status: value ? 1 : 0 }); }
      catch (error) {
        if (alive && running && ticket === epoch && streamId === snapshot.streamId && peer === pc && revision === pauseRevision) {
          paused = previous; applyAudio(); update({ state: previous ? 'paused' : 'live' });
        }
        throw error;
      }
    },
    async caption(value: string) { await patch({ caption: value }); caption = value || null; },
    viewers(count: number) { update({ viewerCount: count }); },
    reconnect() { recover(); },
    stop,
    dispose() { alive = false; unlisten(); [...deviceWatchers].forEach((stopWatching) => stopWatching()); void stop().catch(() => {}); listeners.clear(); },
  };
}
