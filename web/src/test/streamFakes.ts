import { vi } from 'vitest';
import type { LiveStream } from '../types';

export const liveStream = (extra: Partial<LiveStream> = {}): LiveStream => ({ id: 1, competitionId: 1, arenaName: 'Main Arena', angleName: 'Main camera', status: 0, caption: null, audioMuted: false, hasAudio: true, startedAt: '2026-10-16T10:00:00Z', viewerCount: 12, generation: 1, ...extra });
export class FakeTrack {
  enabled = true;
  readyState = 'live';
  kind: string;
  constructor(kind = 'video') { this.kind = kind; }
  stop = vi.fn(() => { this.readyState = 'ended'; });
}
export class FakeMediaStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) { this.tracks = tracks; }
  getTracks() { return [...this.tracks]; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
  addTrack(track: FakeTrack) { this.tracks.push(track); }
  removeTrack(track: FakeTrack) { this.tracks = this.tracks.filter((item) => item !== track); }
}
export class FakePeer {
  static instances: FakePeer[] = [];
  static connect = true;
  static simulcast = true;
  connectionState = 'new';
  iceConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { track: FakeTrack }) => void) | null = null;
  transceivers: { mid: string; sender: { replaceTrack: ReturnType<typeof vi.fn> } }[] = [];
  configuration: RTCConfiguration;
  constructor(configuration: RTCConfiguration) { this.configuration = configuration; FakePeer.instances.push(this); }
  close = vi.fn(() => { this.connectionState = 'closed'; });
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'publisher offer' }));
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'viewer answer' }));
  setLocalDescription = vi.fn(async (value: RTCSessionDescriptionInit) => { this.localDescription = value; });
  setRemoteDescription = vi.fn(async (value: RTCSessionDescriptionInit) => {
    if (value.type === 'answer' && FakePeer.connect) this.connectionState = 'connected';
  });
  addTransceiver = vi.fn((_track: FakeTrack, options: RTCRtpTransceiverInit) => {
    if (options.sendEncodings && !FakePeer.simulcast) throw new Error('simulcast unavailable');
    const transceiver = { mid: String(this.transceivers.length), sender: { replaceTrack: vi.fn(async () => {}) } };
    this.transceivers.push(transceiver);
    return transceiver;
  });
  getStats = vi.fn(async (): Promise<Map<string, { type: string; kind?: string; packetsSent?: number; bytesSent?: number; qualityLimitationReason?: string; framesDecoded?: number }>> => new Map([
    ['out', { type: 'outbound-rtp', kind: 'video', packetsSent: Date.now(), bytesSent: Date.now() * 100, qualityLimitationReason: 'none' }],
    ['in', { type: 'inbound-rtp', kind: 'video', framesDecoded: Date.now() }],
  ]));
  change(state: string) { this.connectionState = state; this.onconnectionstatechange?.(new Event('connectionstatechange')); }
  ice(state: string) { this.iceConnectionState = state; this.oniceconnectionstatechange?.(); }
  track(track = new FakeTrack()) { this.ontrack?.({ track }); }
}
export function resetMedia() { FakePeer.instances = []; FakePeer.connect = true; FakePeer.simulcast = true; }
export const fakePeerConstructor = FakePeer as unknown as typeof RTCPeerConnection;
export const fakeStreamConstructor = FakeMediaStream as unknown as typeof MediaStream;
export const asMedia = (media: FakeMediaStream) => media as unknown as MediaStream;
export const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
