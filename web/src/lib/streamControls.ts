import type { LiveStream, StreamCommand, StreamQualityPreset, StreamTelemetry } from '../types';

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

/** The address a second phone opens to start streaming as another angle of the same arena. */
export function cameraPhoneLink(origin: string, competitionId: number, arena: string, angle: string): string {
  return `${origin}/competitions/${competitionId}/broadcast?arena=${encodeURIComponent(arena)}&angle=${encodeURIComponent(angle)}`;
}

export function cameraStatus(stream: LiveStream): string {
  return `${stream.viewerCount} watching · ${stream.status === 1 ? 'Paused' : 'Live'}`;
}
