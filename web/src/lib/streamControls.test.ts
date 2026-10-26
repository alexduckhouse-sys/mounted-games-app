import { describe, expect, it } from 'vitest';
import type { LiveStream, StreamCommand } from '../types';
import { cameraPhoneLink, cameraSettings, cameraStatus, onAirStream } from './streamControls';

const stream = (id: number, extra: Partial<LiveStream> = {}): LiveStream => ({
  id, competitionId: 1, arenaName: 'Arena 1', angleName: `Cam ${id}`, status: 0, caption: null, audioMuted: false,
  hasAudio: true, startedAt: '2026-06-01T10:00:00Z', viewerCount: 3, generation: 1, ...extra,
});
const cut = (value: string): StreamCommand => ({ streamId: 2, arenaName: 'Arena 1', command: 'selectAngle', value, issuedAt: '' });

describe('onAirStream', () => {
  const all = [stream(1), stream(2), stream(3, { status: 2 })];
  it('prefers the camera the producer just picked', () => {
    expect(onAirStream(all, cut('1'), 2)?.id).toBe(2);
  });
  it('follows the last cut when nothing was picked here', () => {
    expect(onAirStream(all, cut('2'), null)?.id).toBe(2);
    expect(onAirStream(all, { ...cut(''), streamId: 2 }, null)?.id).toBe(2);
  });
  it('falls back to the first live camera and ignores ended ones', () => {
    expect(onAirStream(all, null, 3)?.id).toBe(1);
    expect(onAirStream(all, cut('3'), null)?.id).toBe(1);
    expect(onAirStream([stream(3, { status: 2 })], null, null)).toBeNull();
  });
});

describe('camera helpers', () => {
  it('reads settings from telemetry, then the stream', () => {
    expect(cameraSettings(stream(1, { audioMuted: true }))).toEqual({ quality: 'auto', windFilter: false, sound: false });
    expect(cameraSettings(stream(1), { streamId: 1, arenaName: 'A', qualityPreset: '720p', windFilter: true, audioMuted: true, updatedAt: '' }))
      .toEqual({ quality: '720p', windFilter: true, sound: false });
  });
  it('builds the second phone link and the status line', () => {
    expect(cameraPhoneLink('https://x.test', 4, 'Arena 1', 'Finish line')).toBe('https://x.test/competitions/4/broadcast?arena=Arena%201&angle=Finish%20line');
    expect(cameraStatus(stream(1))).toBe('3 watching · Live');
    expect(cameraStatus(stream(1, { status: 1 }))).toBe('3 watching · Paused');
  });
});
