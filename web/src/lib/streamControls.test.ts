import { describe, expect, it } from 'vitest';
import type { LiveStream, StreamCommand } from '../types';
import { cameraArenas, cameraLinkLabel, cameraSettings, cameraStatus, newCamera, onAirStream, previewStreams } from './streamControls';

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
  it('builds the status line', () => {
    expect(cameraStatus(stream(1))).toBe('3 watching · Live');
    expect(cameraStatus(stream(1, { status: 1 }))).toBe('3 watching · Paused');
  });
});

describe('camera links', () => {
  const s = (arenaName: string | null, kind: 0 | 1 = 0, isBreak = false) => ({ arenaName, kind, isBreak });
  it('lists the arenas the API accepts for a link, without All arenas', () => {
    expect(cameraArenas([s('Ring 2'), s('Ring 1'), s('Ring 2')])).toEqual(['Ring 1', 'Ring 2']);
    expect(cameraArenas([])).toEqual(['Main arena']);
    expect(cameraArenas([s(null)])).toEqual(['Main arena']);
    expect(cameraArenas([s('Ring 1'), s(null)])).toEqual(['Main arena', 'Ring 1']);
    expect(cameraArenas([s('Ring 1'), s(null, 1), s('', 0, true)])).toEqual(['Ring 1']);
    expect(cameraArenas([s('Main arena'), s(null)])).toEqual(['Main arena']);
  });
  it('names the link after the arena and position, within 60 characters', () => {
    expect(cameraLinkLabel('Arena 1', 'Finish line')).toBe('Arena 1 · Finish line');
    expect(cameraLinkLabel('A'.repeat(70), 'Finish line')).toHaveLength(60);
  });
  it('spots a camera that joined after the QR code went up', () => {
    const before = [stream(1, { angleName: 'Finish line' })];
    expect(newCamera(before, 'Arena 1', 'Finish line', [1])).toBeNull();
    expect(newCamera([...before, stream(2, { angleName: ' finish LINE ', arenaName: 'arena 1' })], 'Arena 1', 'Finish line', [1])?.id).toBe(2);
    expect(newCamera([stream(3, { angleName: 'Finish line', status: 2 })], 'Arena 1', 'Finish line', [])).toBeNull();
    expect(newCamera([stream(4, { angleName: 'Main stand' })], 'Arena 1', 'Finish line', [])).toBeNull();
    expect(newCamera([stream(5, { angleName: 'Finish line', arenaName: 'Arena 2' })], 'Arena 1', 'Finish line', [])).toBeNull();
  });
  it('previews up to four live cameras in one arena', () => {
    const all = [1, 2, 3, 4, 5].map((id) => stream(id)).concat(stream(6, { arenaName: 'Arena 2' }), stream(7, { status: 2 }));
    expect(previewStreams(all, 'arena 1').map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(previewStreams(all, 'Arena 2').map((item) => item.id)).toEqual([6]);
    expect(previewStreams(all, 'Arena 1', 2)).toHaveLength(2);
  });
});
