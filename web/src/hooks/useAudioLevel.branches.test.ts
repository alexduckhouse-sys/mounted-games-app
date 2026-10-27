import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudioLevel } from './useAudioLevel';

interface MockTrack {
  enabled: boolean;
  muted: boolean;
  readyState: 'live' | 'ended';
}

const makeStream = (tracks: MockTrack[]) =>
  ({ getAudioTracks: () => tracks as unknown as MediaStreamTrack[] }) as unknown as MediaStream;

const liveTrack = (): MockTrack => ({ enabled: true, muted: false, readyState: 'live' });

interface ContextOptions {
  state?: string;
  frequencyBinCount?: number;
  fftSize?: number;
  resume?: () => Promise<void> | undefined;
  noResume?: boolean;
}

function installContext(options: ContextOptions = {}) {
  const resume = vi.fn(options.resume ?? (async () => undefined));
  const close = vi.fn().mockResolvedValue(undefined);
  const created: unknown[] = [];
  class Ctx {
    state = options.state ?? 'running';
    resume = options.noResume ? undefined : resume;
    close = close;
    constructor() {
      created.push(this);
    }
    createAnalyser() {
      return {
        fftSize: options.fftSize ?? 256,
        frequencyBinCount: options.frequencyBinCount ?? 16,
        smoothingTimeConstant: 0,
        getByteFrequencyData: (arr: Uint8Array) => arr.fill(160),
        getByteTimeDomainData: (arr: Uint8Array) => arr.fill(200),
      };
    }
    createMediaStreamSource() {
      return { connect: vi.fn(), disconnect: vi.fn() };
    }
  }
  return { Ctx, resume, close, created };
}

describe('useAudioLevel branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  });

  it('falls back to the prefixed AudioContext on older Safari', () => {
    const { Ctx, created } = installContext();
    vi.stubGlobal('AudioContext', undefined);
    (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext = Ctx;
    const stream = makeStream([liveTrack()]);
    const { result } = renderHook(() => useAudioLevel(stream, { isLive: true }));
    expect(created).toHaveLength(1);
    expect(result.current.level).toBeGreaterThan(0.5);
  });

  it('reports a silent meter when the browser has no Web Audio at all', () => {
    vi.stubGlobal('AudioContext', undefined);
    const stream = makeStream([liveTrack()]);
    const { result } = renderHook(() => useAudioLevel(stream, { isLive: true, sampleIntervalMs: 500 }));
    expect(result.current.hasAudioTrack).toBe(true);
    expect(result.current.level).toBe(0);
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(result.current.silentWarning).toBe(true);
  });

  it('resumes a suspended context on start and on each sample, ignoring resume failures', () => {
    const { Ctx, resume } = installContext({ state: 'suspended', resume: () => Promise.reject(new Error('blocked')) });
    vi.stubGlobal('AudioContext', Ctx);
    const stream = makeStream([liveTrack()]);
    const { unmount } = renderHook(() => useAudioLevel(stream, { isLive: true, sampleIntervalMs: 100 }));
    // once when the context is created, once for the first sample
    expect(resume).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(resume).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('does not try to resume a suspended context that has no resume method', () => {
    const { Ctx } = installContext({ state: 'suspended', noResume: true });
    vi.stubGlobal('AudioContext', Ctx);
    const stream = makeStream([liveTrack()]);
    const { result, unmount } = renderHook(() => useAudioLevel(stream, { isLive: true }));
    expect(result.current.hasAudioTrack).toBe(true);
    unmount();
  });

  it('uses default buffer sizes when the analyser reports none', () => {
    const { Ctx } = installContext({ frequencyBinCount: 0, fftSize: 0 });
    vi.stubGlobal('AudioContext', Ctx);
    const stream = makeStream([liveTrack()]);
    const { result } = renderHook(() => useAudioLevel(stream, { isLive: true }));
    expect(result.current.level).toBeGreaterThan(0.5);
  });

  it('does not close a context that is already closed', () => {
    const { Ctx, close } = installContext({ state: 'closed' });
    vi.stubGlobal('AudioContext', Ctx);
    const stream = makeStream([liveTrack()]);
    const { unmount } = renderHook(() => useAudioLevel(stream, { isLive: true }));
    unmount();
    expect(close).not.toHaveBeenCalled();
  });

  it('copes with the audio track ending, or the stream losing its track list, mid-stream', () => {
    const { Ctx } = installContext();
    vi.stubGlobal('AudioContext', Ctx);
    const track = liveTrack();
    const stream = makeStream([track]);
    const { result } = renderHook(() => useAudioLevel(stream, { isLive: true, sampleIntervalMs: 100 }));
    expect(result.current.hasAudioTrack).toBe(true);

    track.readyState = 'ended';
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.hasAudioTrack).toBe(false);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.level).toBe(0);

    track.readyState = 'live';
    (stream as unknown as { getAudioTracks: unknown }).getAudioTracks = undefined;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.hasAudioTrack).toBe(false);
    expect(result.current.isMuted).toBe(true);
  });

  it('shows a non-live stream without audio as muted but not warning', () => {
    const empty = makeStream([]);
    const { result } = renderHook(() => useAudioLevel(empty, { isLive: false }));
    expect(result.current.isMuted).toBe(true);
    expect(result.current.silentWarning).toBe(false);
    const muted = renderHook(() => useAudioLevel(null, { muted: true, isLive: true }));
    expect(muted.result.current.isMuted).toBe(true);
  });
});
