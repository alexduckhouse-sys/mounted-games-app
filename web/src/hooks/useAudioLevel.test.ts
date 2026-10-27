import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_METER_SEGMENT_COUNT,
  AUDIO_SILENCE_WARNING_MS,
  buildAudioMeterSegments,
  computeAudioLevelFromSamples,
  evaluateAudioSilenceWarning,
  MIC_MUTED_WARNING_TEXT,
  useAudioLevel,
} from './useAudioLevel';

interface MockTrack {
  enabled: boolean;
  muted: boolean;
  readyState: 'live' | 'ended';
}

function makeMockStream(tracks: MockTrack[]): MediaStream {
  return {
    getAudioTracks: () => tracks as unknown as MediaStreamTrack[],
  } as unknown as MediaStream;
}

describe('useAudioLevel pure helpers', () => {
  it('computes normalised audio levels and dB from frequency and time-domain samples', () => {
    expect(computeAudioLevelFromSamples(new Uint8Array(0))).toEqual({ level: 0, db: -60 });

    const silentFreq = new Uint8Array([0, 0, 0, 0]);
    const silentTime = new Uint8Array([128, 128, 128, 128]);
    expect(computeAudioLevelFromSamples(silentFreq, silentTime)).toEqual({ level: 0, db: -60 });

    const loudFreq = new Uint8Array([200, 220, 190, 210]);
    const loudTime = new Uint8Array([255, 0, 255, 0]);
    const loud = computeAudioLevelFromSamples(loudFreq, loudTime);
    expect(loud.level).toBe(1);
    expect(loud.db).toBe(0);

    const midFreq = new Uint8Array([64, 64, 64, 64]);
    const mid = computeAudioLevelFromSamples(midFreq);
    expect(mid.level).toBeGreaterThan(0.3);
    expect(mid.level).toBeLessThan(0.4);
    expect(mid.db).toBeLessThan(0);
    expect(mid.db).toBeGreaterThan(-15);
  });

  it('builds segmented green/amber/red dB meter bars and marks the peak segment', () => {
    const idle = buildAudioMeterSegments(0, 0, 12);
    expect(idle).toHaveLength(12);
    expect(idle.every((s) => !s.active && !s.isPeak)).toBe(true);
    expect(idle[0].zone).toBe('green');
    expect(idle[8].zone).toBe('amber');
    expect(idle[11].zone).toBe('red');

    const active = buildAudioMeterSegments(0.5, 0.85, 10);
    expect(active.filter((s) => s.active).length).toBeGreaterThanOrEqual(5);
    expect(active.find((s) => s.isPeak)?.index).toBe(8);
  });

  it('evaluates silence and mute warnings only when live', () => {
    expect(evaluateAudioSilenceWarning({ isLive: false, isMuted: true, silentDurationMs: 20_000 })).toEqual({
      silentWarning: false,
      warningMessage: null,
    });
    expect(evaluateAudioSilenceWarning({ isLive: true, isMuted: true, silentDurationMs: 0 })).toEqual({
      silentWarning: true,
      warningMessage: MIC_MUTED_WARNING_TEXT,
    });
    expect(evaluateAudioSilenceWarning({ isLive: true, isMuted: false, silentDurationMs: 8_000 })).toEqual({
      silentWarning: false,
      warningMessage: null,
    });
    expect(evaluateAudioSilenceWarning({ isLive: true, isMuted: false, silentDurationMs: 8_100 })).toEqual({
      silentWarning: true,
      warningMessage: MIC_MUTED_WARNING_TEXT,
    });
  });
});

describe('useAudioLevel hook (#250)', () => {
  let currentFreqByte = 0;
  let currentTimeByte = 128;
  let closeSpy: ReturnType<typeof vi.fn>;
  let disconnectSpy: ReturnType<typeof vi.fn>;
  let connectSpy: ReturnType<typeof vi.fn>;
  let includeTimeDomain = true;

  beforeEach(() => {
    vi.useFakeTimers();
    currentFreqByte = 0;
    currentTimeByte = 128;
    includeTimeDomain = true;
    closeSpy = vi.fn().mockResolvedValue(undefined);
    disconnectSpy = vi.fn();
    connectSpy = vi.fn();

    class MockAudioContext {
      state = 'running';
      createAnalyser() {
        const analyser: Record<string, unknown> = {
          fftSize: 256,
          frequencyBinCount: 16,
          smoothingTimeConstant: 0.65,
          getByteFrequencyData: (arr: Uint8Array) => {
            arr.fill(currentFreqByte);
          },
        };
        if (includeTimeDomain) {
          analyser.getByteTimeDomainData = (arr: Uint8Array) => {
            arr.fill(currentTimeByte);
          };
        }
        return analyser;
      }
      createMediaStreamSource() {
        return {
          connect: connectSpy,
          disconnect: disconnectSpy,
        };
      }
      close = closeSpy;
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns an idle state when no stream is provided', () => {
    const { result } = renderHook(() => useAudioLevel(null));
    expect(result.current.level).toBe(0);
    expect(result.current.hasAudioTrack).toBe(false);
    expect(result.current.silentWarning).toBe(false);
    expect(result.current.warningMessage).toBeNull();
    expect(result.current.segments).toHaveLength(AUDIO_METER_SEGMENT_COUNT);
  });

  it('flags a warning immediately when a live stream has no audio tracks', () => {
    const stream = makeMockStream([]);
    const { result } = renderHook(() => useAudioLevel(stream, { isLive: true }));
    expect(result.current.hasAudioTrack).toBe(false);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.silentWarning).toBe(true);
    expect(result.current.warningMessage).toBe(MIC_MUTED_WARNING_TEXT);
  });

  it('samples live audio via AudioContext + AnalyserNode, decays peak, and closes AudioContext on unmount', () => {
    currentFreqByte = 160;
    currentTimeByte = 200;
    const stream = makeMockStream([{ enabled: true, muted: false, readyState: 'live' }]);
    const { result, unmount } = renderHook(() => useAudioLevel(stream, { isLive: true, sampleIntervalMs: 100 }));

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(result.current.hasAudioTrack).toBe(true);
    expect(result.current.isMuted).toBe(false);
    expect(result.current.level).toBeGreaterThan(0.5);
    expect(result.current.peakLevel).toBe(result.current.level);
    expect(result.current.silentWarning).toBe(false);

    const initialPeak = result.current.peakLevel;
    currentFreqByte = 40;
    currentTimeByte = 135;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.level).toBeLessThan(initialPeak);
    expect(result.current.peakLevel).toBeLessThanOrEqual(initialPeak);
    expect(result.current.peakLevel).toBeGreaterThanOrEqual(result.current.level);

    unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('triggers the "Mic muted / no audio detected" warning after > 8 seconds of silence and clears when speech resumes', () => {
    currentFreqByte = 0;
    currentTimeByte = 128;
    const stream = makeMockStream([{ enabled: true, muted: false, readyState: 'live' }]);
    const { result } = renderHook(() => useAudioLevel(stream, { isLive: true, sampleIntervalMs: 500 }));

    expect(result.current.silentWarning).toBe(false);

    act(() => {
      vi.advanceTimersByTime(AUDIO_SILENCE_WARNING_MS);
    });
    expect(result.current.silentDurationMs).toBe(AUDIO_SILENCE_WARNING_MS);
    expect(result.current.silentWarning).toBe(false);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.silentDurationMs).toBe(AUDIO_SILENCE_WARNING_MS + 500);
    expect(result.current.silentWarning).toBe(true);
    expect(result.current.warningMessage).toBe(MIC_MUTED_WARNING_TEXT);

    // Resume speaking -> warning clears immediately on next sample.
    currentFreqByte = 180;
    currentTimeByte = 210;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.silentDurationMs).toBe(0);
    expect(result.current.silentWarning).toBe(false);
    expect(result.current.warningMessage).toBeNull();
  });

  it('triggers the warning immediately when the track is muted or disabled while live, and works without getByteTimeDomainData', () => {
    includeTimeDomain = false;
    currentFreqByte = 120;
    const track: MockTrack = { enabled: true, muted: false, readyState: 'live' };
    const stream = makeMockStream([track]);
    const { result } = renderHook(() => useAudioLevel(stream, { isLive: true, sampleIntervalMs: 200 }));

    expect(result.current.level).toBeGreaterThan(0.5);
    expect(result.current.silentWarning).toBe(false);

    track.enabled = false;
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isMuted).toBe(true);
    expect(result.current.level).toBe(0);
    expect(result.current.silentWarning).toBe(true);
    expect(result.current.warningMessage).toBe(MIC_MUTED_WARNING_TEXT);
  });

  it('handles environments where AudioContext throws on construction', () => {
    vi.stubGlobal(
      'AudioContext',
      class BrokenAudioContext {
        constructor() {
          throw new Error('AudioContext blocked');
        }
      },
    );
    const stream = makeMockStream([{ enabled: true, muted: false, readyState: 'live' }]);
    const { result, unmount } = renderHook(() => useAudioLevel(stream, { isLive: true, sampleIntervalMs: 500 }));
    expect(result.current.hasAudioTrack).toBe(true);
    expect(result.current.level).toBe(0);
    unmount();
  });
});
