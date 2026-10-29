import { describe, expect, it } from 'vitest';
import { heat, race } from '../test/factories';
import type { QueuedScore } from '../offline/scoreOutbox';
import { pointsForPlace, withQueuedResults } from './queuedView';
import { overridePoints } from './raceScoring';

describe('queued manual points', () => {
  it('shows the same half-point award while offline that the submitted directive saves', () => {
    const h = heat(1, { races: [race(1)] });
    const q: QueuedScore = {
      raceId: 1, competitionId: 1, sessionId: 1, label: 'Synthetic race',
      places: [...overridePoints([], 1, 2.5, 'Synthetic correction'), { teamId: 2, place: 0, eliminated: false, refereeNote: '[pts:5]' }],
      expected: [], teamNames: { 1: 'Synthetic team' }, queuedAt: '2026-01-01T00:00:00Z', state: 'waiting',
    };
    expect(withQueuedResults(h, [q], 3).races[0].results.map((r) => r.points)).toEqual([2.5, 0]);
  });
});


describe('preview matches server scoring', () => {
  const entries = [1, 2, 3, 4].map((teamId) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex: teamId }));
  it.each(['B Final', 'B Final Part 1', 'B Final · 2', 'B Final - Part 2'])('uses its own field for %s', (label) => {
    const final = heat(1, { label, entries });
    expect(pointsForPlace(final, 6, 1, false)).toBe(4);
    expect(pointsForPlace(final, 3, 1, false)).toBe(3);
    expect(pointsForPlace({ ...final, raceRoundStage: 2 }, 6, 4, false)).toBe(2);
  });
  it('keeps explicit half points, gives note directives priority, and previews dead heats', () => {
    const h = heat(1, { entries, races: [race(1)] });
    const q: QueuedScore = { raceId: 1, competitionId: 1, sessionId: 1, label: 'Race', expected: [], teamNames: {}, queuedAt: '', state: 'waiting', places: [
      { teamId: 1, place: 1, eliminated: false, refereeNote: '[dead-heat]' },
      { teamId: 2, place: 1, eliminated: false, refereeNote: '[dead-heat]' },
      { teamId: 3, place: 3, eliminated: false, points: 2.5 },
      { teamId: 4, place: 4, eliminated: false, points: 4, refereeNote: '[adj:+0.5]' },
    ] };
    expect(withQueuedResults(h, [q], 4).races[0].results.map((r) => r.points)).toEqual([3.5, 3.5, 2.5, 1.5]);
    q.places[2] = { ...q.places[2], refereeNote: '[pts:1.5]' };
    expect(withQueuedResults(h, [q], 4).races[0].results[2].points).toBe(1.5);
  });
});

 it('keeps queued scores from an earlier programme out of the replacement preview', () => {
  const h = heat(1, { races: [race(1, { programmeRevision: 1 })] });
  const q: QueuedScore = { raceId: 1, competitionId: 1, sessionId: 1, label: 'Earlier race', expected: [], teamNames: {}, queuedAt: '', state: 'waiting', places: [{ teamId: 1, place: 1, eliminated: false }] };
  expect(withQueuedResults(h, [q], 4)).toBe(h);
  expect(withQueuedResults(h, [{ ...q, expectedProgrammeRevision: 1 }], 4).races[0].isComplete).toBe(true);
});
