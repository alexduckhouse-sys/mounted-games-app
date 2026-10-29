import { describe, expect, it } from 'vitest';
import { computeRaceChapters, type ReplayRaceMarker } from './replayChapters';

describe('computeRaceChapters', () => {
  it('returns empty array when no races are provided', () => {
    expect(computeRaceChapters({ createdAt: '2026-07-01T10:01:00Z', durationSeconds: 60 })).toEqual([]);
    expect(computeRaceChapters({ createdAt: '2026-07-01T10:01:00Z', durationSeconds: 60, races: [] })).toEqual([]);
  });

  it('computes R1, R2, R3 offsets from startedAt and finishedAt timestamps within the clip window', () => {
    const races: ReplayRaceMarker[] = [
      {
        id: 2,
        name: 'Mug Race',
        orderIndex: 2,
        startIsExplicit: true,
        startedAt: '2026-07-01T10:00:25Z',
        finishedAt: '2026-07-01T10:00:48Z',
        isComplete: true,
      },
      {
        id: 1,
        name: 'Bending',
        orderIndex: 1,
        startIsExplicit: true,
        startedAt: '2026-07-01T10:00:05Z',
        finishedAt: '2026-07-01T10:00:25Z',
        isComplete: true,
      },
      {
        id: 3,
        name: 'Carton',
        orderIndex: 3,
        startedAt: null,
        finishedAt: '2026-07-01T10:00:58Z',
        isComplete: true,
      },
    ];

    const chapters = computeRaceChapters(
      { createdAt: '2026-07-01T10:01:00Z', durationSeconds: 60 },
      races,
    );

    expect(chapters).toEqual([
      { estimated: false, id: 1, code: 'R1', name: 'Bending', timeSec: 2, endSec: 25 },
      { estimated: false, id: 2, code: 'R2', name: 'Mug Race', timeSec: 22, endSec: 48 },
      { estimated: true, id: 3, code: 'R3', name: 'Carton', timeSec: 38, endSec: 58 },
    ]);
  });

  it('falls back to evenly spaced chapter markers when race timestamps are absent or outside the clip window', () => {
    const races: ReplayRaceMarker[] = [
      { id: 10, name: 'Bottle', orderIndex: 1, startedAt: null, finishedAt: null, isComplete: false },
      { id: 20, name: 'Flag', orderIndex: 1, startedAt: '2026-07-01T08:00:00Z', finishedAt: null, isComplete: false },
    ];

    const chapters = computeRaceChapters({
      createdAt: '2026-07-01T10:01:00Z',
      durationSeconds: 40,
      races,
    });

    expect(chapters).toEqual([
      { estimated: true, id: 10, code: 'R1', name: 'Bottle', timeSec: 0, endSec: 20 },
      { estimated: true, id: 20, code: 'R2', name: 'Flag', timeSec: 20, endSec: 40 },
    ]);

    const invalidDateChapters = computeRaceChapters({
      createdAt: 'not-a-date',
      durationSeconds: 0,
      races: [{ id: 1, name: 'Litter', orderIndex: 1, isComplete: false }],
    });
    expect(invalidDateChapters).toEqual([{ estimated: true, id: 1, code: 'R1', name: 'Litter', timeSec: 0, endSec: 1 }]);
  });
});

it('maps flag-down across camera gaps', () => {
  const clip = { createdAt: '2026-07-01T10:10:00Z', durationSeconds: 60,
    recordingSegments: [
      { startAt: '2026-07-01T10:00:00Z', endAt: '2026-07-01T10:00:30Z', offsetSeconds: 0 },
      { startAt: '2026-07-01T10:09:30Z', endAt: '2026-07-01T10:10:00Z', offsetSeconds: 30 },
    ], races: [{ id: 1, name: 'Bending', orderIndex: 1, startIsExplicit: true, startedAt: '2026-07-01T10:09:40Z' }] };
  expect(computeRaceChapters(clip)[0].timeSec).toBe(37);
  expect(computeRaceChapters({ ...clip, races: [{ ...clip.races[0], startedAt: '2026-07-01T10:00:10Z' }] })[0].timeSec).toBe(7);
});
it('does not invent a chapter when every known race is outside the recording', () => {
  expect(computeRaceChapters({ createdAt: '2026-07-01T10:01:00Z', durationSeconds: 60,
    races: [{ id: 1, name: 'Bending', orderIndex: 1, startIsExplicit: true, startedAt: '2026-07-01T09:00:00Z' }] })).toEqual([]);
});
