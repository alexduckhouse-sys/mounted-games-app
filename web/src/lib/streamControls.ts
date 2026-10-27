import type { LiveStream, Session, StreamCommand, StreamQualityPreset, StreamTelemetry } from '../types';

/** The camera viewers see: the one the producer last cut to, else the first live one. */
export function onAirStream(streams: LiveStream[], command: StreamCommand | null | undefined, pickedId: number | null): LiveStream | null {
  const live = streams.filter((stream) => stream.status !== 2);
  const picked = pickedId != null ? live.find((stream) => stream.id === pickedId) : undefined;
  if (picked) return picked;
  if (command?.command === 'selectAngle') {
    const target = live.find((stream) => stream.id === Number(command.value || command.streamId));
    if (target) return target;
  }
  return live[0] ?? null;
}

export interface QualityChoice { label: string; preset: StreamQualityPreset }

export const QUALITY_CHOICES: QualityChoice[] = [
  { label: '360p Saver', preset: '360p' },
  { label: '720p', preset: '720p' },
  { label: 'Auto HD', preset: 'auto' },
];

/** What a camera is set to now: the phone's own report first, else what the stream record says. */
export function cameraSettings(stream: LiveStream, telemetry?: StreamTelemetry | null) {
  return {
    quality: (telemetry?.qualityPreset ?? 'auto') as string,
    windFilter: Boolean(telemetry?.windFilter),
    sound: !(telemetry?.audioMuted ?? stream.audioMuted),
  };
}

export const CAMERA_ANGLES = ['Finish line', 'Changeover line', 'Collecting ring', 'Main stand'] as const;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The arenas a camera link can be made for. Mirrors the API's scorer-link arenas (`ScorerLinksController`):
 * every named arena, plus "Main arena" when nothing is named or a race session has no arena. "All arenas"
 * is left out, because a camera films one place.
 */
export function cameraArenas(sessions: Pick<Session, 'arenaName' | 'kind' | 'isBreak'>[]): string[] {
  const named = [...new Set(sessions.map((session) => session.arenaName).filter((name): name is string => !!name))].sort();
  const unnamed = named.length === 0 || sessions.some((session) => session.kind === 0 && !session.isBreak && !session.arenaName);
  return unnamed && !named.includes('Main arena') ? ['Main arena', ...named] : named;
}

/** What the camera link is called in the scorer links list (the API allows 60 characters). */
export function cameraLinkLabel(arena: string, angle: string): string {
  return `${arena} · ${angle}`.slice(0, 60);
}

/** A camera for this arena and position that wasn't there when the QR code went up. */
export function newCamera(streams: LiveStream[], arena: string, angle: string, knownIds: readonly number[]): LiveStream | null {
  return streams.find((stream) => stream.status !== 2 && !knownIds.includes(stream.id)
    && same(stream.arenaName, arena) && same(stream.angleName, angle)) ?? null;
}

export const MAX_PREVIEWS = 4;

/** The cameras in one arena that get a small live picture, at most `max` of them. */
export function previewStreams(streams: LiveStream[], arena: string, max = MAX_PREVIEWS): LiveStream[] {
  return streams.filter((stream) => stream.status !== 2 && same(stream.arenaName, arena)).slice(0, max);
}

export function cameraStatus(stream: LiveStream): string {
  return `${stream.viewerCount} watching · ${stream.status === 1 ? 'Paused' : 'Live'}`;
}
