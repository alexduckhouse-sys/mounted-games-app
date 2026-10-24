import { describe, expect, it } from 'vitest';
import { heat, race } from '../test/factories';
import type { QueuedScore } from '../offline/scoreOutbox';
import { withQueuedResults } from './queuedView';
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
