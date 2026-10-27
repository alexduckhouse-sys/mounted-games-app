// Unused in web UI yet — reserved for iOS / upcoming wiring
import { useEffect, useRef, useState } from 'react';

export const AUDIO_SILENCE_THRESHOLD = 0.015;
export const AUDIO_SILENCE_WARNING_MS = 8_000;
export const AUDIO_METER_SEGMENT_COUNT = 12;
export const MIC_MUTED_WARNING_TEXT = 'Mic muted / no audio detected';

export interface AudioMeterSegment {
  index: number;
  threshold: number;
  zone: 'green' | 'amber' | 'red';
  active: boolean;
  isPeak: boolean;
}

export interface AudioLevelState {
  /** Instantaneous normalised audio level in [0, 1]. */
  level: number;
  /** Recent peak level in [0, 1]. */
  peakLevel: number;
  /** Estimated dBFS in [-60, 0]. */
  db: number;
  /** Whether a live audio track is present and enabled. */
  hasAudioTrack: boolean;
  /** Whether the audio track is explicitly muted/disabled. */
  isMuted: boolean;
  /** How long (ms) the microphone has been continuously silent or muted while live. */
  silentDurationMs: number;
  /** True when live and muted or silent for > 8 seconds. */
  silentWarning: boolean;
  /** Human-readable warning message ("Mic muted / no audio detected") when `silentWarning` is true. */
  warningMessage: string | null;
  /** Segmented dB/peak meter bars ready for rendering. */
  segments: AudioMeterSegment[];
}

export interface UseAudioLevelOptions {
  /** Whether the broadcast or commentary session is currently live. Defaults to true when a stream is provided. */
  isLive?: boolean;
  /** Explicit external mute state from UI controls, if any. */
  muted?: boolean;
  /** Sampling interval in milliseconds. Defaults to 100ms. */
  sampleIntervalMs?: number;
  /** Duration of silence in milliseconds before raising the warning. Defaults to 8000ms (8s). */
  silenceWarningMs?: number;
  /** Minimum normalised level to count as audible signal. Defaults to 0.015. */
  silenceThreshold?: number;
  /** Number of visual meter bars. Defaults to 12. */
  segmentCount?: number;
}

/**
 * Computes a normalised `[0, 1]` audio level and `[-60, 0]` dBFS estimate from
 * `AnalyserNode.getByteFrequencyData` and optional `getByteTimeDomainData` buffers.
 */
export function computeAudioLevelFromSamples(
  frequencyData: Uint8Array,
  timeDomainData?: Uint8Array,
): { level: number; db: number } {
  let freqEnergy = 0;
  if (frequencyData.length > 0) {
    let sum = 0;
    for (let i = 0; i < frequencyData.length; i++) {
      sum += frequencyData[i] / 255;
    }
    freqEnergy = sum / frequencyData.length;
  }

  let rms = 0;
  if (timeDomainData && timeDomainData.length > 0) {
    let sumSquares = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      const centred = (timeDomainData[i] - 128) / 128;
      sumSquares += centred * centred;
    }
    rms = Math.sqrt(sumSquares / timeDomainData.length);
  }

  // Combine RMS (boosted for natural speech dynamics) and frequency bin average.
  const combined = Math.max(rms * 2.2, freqEnergy * 1.35);
  const level = Math.min(1, Math.max(0, Math.round(combined * 1000) / 1000));
  const db = level <= 0.001
    ? -60
    : Math.max(-60, Math.min(0, Math.round(20 * Math.log10(level) * 10) / 10));

  return { level, db };
}

/**
 * Builds segmented dB/peak meter bars with green/amber/red zones.
 */
export function buildAudioMeterSegments(
  level: number,
  peakLevel: number,
  segmentCount = AUDIO_METER_SEGMENT_COUNT,
): AudioMeterSegment[] {
  const count = Math.max(1, Math.floor(segmentCount));
  const clampedLevel = Math.min(1, Math.max(0, level));
  const clampedPeak = Math.min(1, Math.max(clampedLevel, peakLevel));
  const peakIndex = clampedPeak > 0.02
    ? Math.min(count - 1, Math.max(0, Math.ceil(clampedPeak * count) - 1))
    : -1;

  const segments: AudioMeterSegment[] = [];
  for (let i = 0; i < count; i++) {
    const threshold = (i + 1) / count;
    const ratio = i / count;
    const zone: AudioMeterSegment['zone'] = ratio >= 0.82 ? 'red' : ratio >= 0.62 ? 'amber' : 'green';
    const active = clampedLevel >= threshold - 0.5 / count && clampedLevel > 0.01;
    segments.push({
      index: i,
      threshold,
      zone,
      active,
      isPeak: i === peakIndex,
    });
  }
  return segments;
}

/**
 * Evaluates whether the `"Mic muted / no audio detected"` warning should be shown.
 */
export function evaluateAudioSilenceWarning(params: {
  isLive: boolean;
  isMuted: boolean;
  silentDurationMs: number;
  silenceWarningMs?: number;
}): { silentWarning: boolean; warningMessage: string | null } {
  const {
    isLive,
    isMuted,
    silentDurationMs,
    silenceWarningMs = AUDIO_SILENCE_WARNING_MS,
  } = params;

  if (!isLive) {
    return { silentWarning: false, warningMessage: null };
  }

  if (isMuted || silentDurationMs > silenceWarningMs) {
    return {
      silentWarning: true,
      warningMessage: MIC_MUTED_WARNING_TEXT,
    };
  }

  return { silentWarning: false, warningMessage: null };
}

function getAudioContextConstructor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const win = window as Window & typeof globalThis & { webkitAudioContext?: new () => AudioContext };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

/**
 * Real-time microphone level hook using the Web Audio API (`AudioContext`,
 * `createMediaStreamSource(stream)`, and `AnalyserNode.getByteFrequencyData`).
 * Automatically closes the `AudioContext` on unmount or stream change.
 */
export function useAudioLevel(
  stream: MediaStream | null | undefined,
  options: UseAudioLevelOptions = {},
): AudioLevelState {
  const {
    isLive = Boolean(stream),
    muted = false,
    sampleIntervalMs = 100,
    silenceWarningMs = AUDIO_SILENCE_WARNING_MS,
    silenceThreshold = AUDIO_SILENCE_THRESHOLD,
    segmentCount = AUDIO_METER_SEGMENT_COUNT,
  } = options;

  const [state, setState] = useState<AudioLevelState>(() => {
    const initialWarning = evaluateAudioSilenceWarning({
      isLive: Boolean(stream) && isLive,
      isMuted: muted,
      silentDurationMs: 0,
      silenceWarningMs,
    });
    return {
      level: 0,
      peakLevel: 0,
      db: -60,
      hasAudioTrack: false,
      isMuted: muted,
      silentDurationMs: 0,
      silentWarning: initialWarning.silentWarning,
      warningMessage: initialWarning.warningMessage,
      segments: buildAudioMeterSegments(0, 0, segmentCount),
    };
  });

  const silentDurationRef = useRef(0);
  const peakLevelRef = useRef(0);

  useEffect(() => {
    silentDurationRef.current = 0;
    peakLevelRef.current = 0;

    const audioTracks = stream && typeof stream.getAudioTracks === 'function'
      ? stream.getAudioTracks()
      : [];
    const activeTrack = audioTracks.find((t) => t.readyState !== 'ended') ?? null;

    if (!stream || !activeTrack) {
      return undefined;
    }

    const AudioCtx = getAudioContextConstructor();
    let audioContext: AudioContext | null = null;
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let analyserNode: AnalyserNode | null = null;
    let freqBuffer = new Uint8Array(64);
    let timeBuffer = new Uint8Array(64);

    if (AudioCtx) {
      try {
        audioContext = new AudioCtx();
        if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
          void Promise.resolve(audioContext.resume()).catch(() => {});
        }
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 256;
        analyserNode.smoothingTimeConstant = 0.65;
        sourceNode = audioContext.createMediaStreamSource(stream);
        sourceNode.connect(analyserNode);
        freqBuffer = new Uint8Array(analyserNode.frequencyBinCount || 64);
        timeBuffer = new Uint8Array(analyserNode.fftSize || 128);
      } catch {
        // Ignore Web Audio initialisation failures in restricted environments and fall back to track state.
      }
    }

    const sampleOnce = (elapsedMs: number) => {
      if (audioContext && audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
        void Promise.resolve(audioContext.resume()).catch(() => {});
      }
      const currentTracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : [];
      const track = currentTracks.find((t) => t.readyState !== 'ended') ?? null;
      const trackMuted = !track || track.enabled === false || track.muted === true || track.readyState === 'ended';
      const isMutedNow = muted || trackMuted;

      let level = 0;
      let db = -60;

      if (!isMutedNow && analyserNode) {
        analyserNode.getByteFrequencyData(freqBuffer);
        if (typeof analyserNode.getByteTimeDomainData === 'function') {
          analyserNode.getByteTimeDomainData(timeBuffer);
          const computed = computeAudioLevelFromSamples(freqBuffer, timeBuffer);
          level = computed.level;
          db = computed.db;
        } else {
          const computed = computeAudioLevelFromSamples(freqBuffer);
          level = computed.level;
          db = computed.db;
        }
      }

      if (isMutedNow || level < silenceThreshold) {
        silentDurationRef.current += elapsedMs;
      } else {
        silentDurationRef.current = 0;
      }

      peakLevelRef.current = level >= peakLevelRef.current
        ? level
        : Math.max(level, Math.round(peakLevelRef.current * 0.88 * 1000) / 1000);

      const warning = evaluateAudioSilenceWarning({
        isLive,
        isMuted: isMutedNow,
        silentDurationMs: silentDurationRef.current,
        silenceWarningMs,
      });

      setState({
        level,
        peakLevel: peakLevelRef.current,
        db,
        hasAudioTrack: Boolean(track && track.readyState !== 'ended'),
        isMuted: isMutedNow,
        silentDurationMs: silentDurationRef.current,
        silentWarning: warning.silentWarning,
        warningMessage: warning.warningMessage,
        segments: buildAudioMeterSegments(level, peakLevelRef.current, segmentCount),
      });
    };

    sampleOnce(0);
    const interval = setInterval(() => sampleOnce(sampleIntervalMs), sampleIntervalMs);

    return () => {
      clearInterval(interval);
      try {
        sourceNode?.disconnect();
      } catch {
        // Ignore disconnect errors on cleanup.
      }
      if (audioContext && typeof audioContext.close === 'function' && audioContext.state !== 'closed') {
        void Promise.resolve(audioContext.close()).catch(() => {});
      }
    };
  }, [stream, isLive, muted, sampleIntervalMs, silenceWarningMs, silenceThreshold, segmentCount]);

  const audioTracks = stream && typeof stream.getAudioTracks === 'function'
    ? stream.getAudioTracks()
    : [];
  const activeTrack = audioTracks.find((t) => t.readyState !== 'ended') ?? null;

  if (!stream || !activeTrack) {
    const warning = evaluateAudioSilenceWarning({
      isLive,
      isMuted: muted || Boolean(stream),
      silentDurationMs: isLive && Boolean(stream) ? silenceWarningMs + 1 : 0,
      silenceWarningMs,
    });
    return {
      level: 0,
      peakLevel: 0,
      db: -60,
      hasAudioTrack: false,
      isMuted: muted || Boolean(stream),
      silentDurationMs: 0,
      silentWarning: warning.silentWarning,
      warningMessage: warning.warningMessage,
      segments: buildAudioMeterSegments(0, 0, segmentCount),
    };
  }

  return state;
}
