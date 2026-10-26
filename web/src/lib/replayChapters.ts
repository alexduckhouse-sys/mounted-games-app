import type { Race } from '../types';

export type ReplayRaceMarker = Pick<Race, 'id' | 'name' | 'orderIndex' | 'startedAt' | 'finishedAt' | 'isComplete'>;

export interface RaceChapter {
  id: number;
  code: string;
  name: string;
  timeSec: number;
  endSec?: number;
}

export interface ReplayClipWindow {
  createdAt: string;
  durationSeconds: number;
  races?: ReadonlyArray<ReplayRaceMarker>;
}

/**
 * Computes clickable race chapter markers (`R1`, `R2`, `R3`...) and their offset
 * in seconds within a replay clip (`[0, durationSeconds]`).
 * Uses `startedAt` / `finishedAt` timestamps when they fall within the clip window,
 * or distributes the heat's races evenly across the clip duration as a fallback.
 */
export function computeRaceChapters(
  clip: ReplayClipWindow,
  races?: ReadonlyArray<ReplayRaceMarker>,
): RaceChapter[] {
  const source = races ?? clip.races;
  if (!source || source.length === 0) return [];
  const duration = Math.max(1, clip.durationSeconds || 0);
  const clipEndMs = Date.parse(clip.createdAt);
  const clipStartMs = Number.isFinite(clipEndMs) ? clipEndMs - duration * 1000 : NaN;

  const sorted = [...source].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);

  if (Number.isFinite(clipStartMs)) {
    const withTimestamps: RaceChapter[] = [];
    sorted.forEach((race, idx) => {
      const startMs = race.startedAt ? Date.parse(race.startedAt) : NaN;
      const finishMs = race.finishedAt ? Date.parse(race.finishedAt) : NaN;
      const anchorMs = Number.isFinite(startMs)
        ? startMs
        : Number.isFinite(finishMs)
          ? Math.max(clipStartMs, finishMs - Math.min(20_000, (duration * 1000) / Math.max(1, sorted.length)))
          : NaN;
      if (Number.isFinite(anchorMs) && anchorMs >= clipStartMs - 5_000 && anchorMs <= clipEndMs + 5_000) {
        const timeSec = Math.max(0, Math.min(duration, (anchorMs - clipStartMs) / 1000));
        const endSec = Number.isFinite(finishMs)
          ? Math.max(timeSec, Math.min(duration, (finishMs - clipStartMs) / 1000))
          : undefined;
        withTimestamps.push({
          id: race.id,
          code: `R${idx + 1}`,
          name: race.name,
          timeSec: Math.round(timeSec * 10) / 10,
          endSec: endSec !== undefined ? Math.round(endSec * 10) / 10 : undefined,
        });
      }
    });
    if (withTimestamps.length > 0) return withTimestamps;
  }

  const step = duration / sorted.length;
  return sorted.map((race, idx) => ({
    id: race.id,
    code: `R${idx + 1}`,
    name: race.name,
    timeSec: Math.round(idx * step * 10) / 10,
    endSec: Math.round((idx + 1) * step * 10) / 10,
  }));
}
