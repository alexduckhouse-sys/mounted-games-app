import { describe, expect, it } from 'vitest';
import { heat, race, session } from '../test/factories';
import { nextRoundLanes } from './nextRoundLanes';

describe('nextRoundLanes', () => {
  it('interleaves qualifier finishers provisionally when final entries are empty, skipping HC and sit-out teams', () => {
    const q1 = heat(1, {
      orderIndex: 1,
      raceRoundId: 10,
      raceRoundStage: 1,
      entries: [
        { id: 1, teamId: 101, teamName: 'Alpha', laneIndex: 1, bibColour: 'Red' },
      ],
      races: [
        race(1, {
          isComplete: true,
          results: [
            { id: 1, teamId: 101, teamName: 'Alpha', placing: 1, points: 4, eliminated: false, isSitOut: false },
            { id: 2, teamId: 102, teamName: 'Beta', placing: 2, points: 3, eliminated: false, isSitOut: false },
            { id: 3, teamId: 103, teamName: 'HC Team', placing: 1, points: 4, eliminated: false, isSitOut: false },
          ],
        }),
      ],
    });
    const q2 = heat(2, {
      orderIndex: 2,
      raceRoundId: 10,
      raceRoundStage: 1,
      entries: [],
      races: [
        race(2, {
          isComplete: true,
          results: [
            { id: 4, teamId: 201, teamName: 'Gamma', placing: 1, points: 4, eliminated: false, isSitOut: false },
          ],
        }),
      ],
    });
    const finalHeat = heat(3, {
      orderIndex: 3,
      raceRoundId: 10,
      raceRoundStage: 2,
      label: null,
      entries: [],
      races: [race(3, { isComplete: false })],
    });
    const s = session(1, { lanesPerHeat: 2, heats: [q1, q2, finalHeat] });

    const provisional = nextRoundLanes(s, finalHeat, null, 2, new Set([103]));
    expect(provisional).toEqual({
      title: 'Lanes for the final',
      note: 'Provisional. The final is filled from the qualifiers once the results are saved, and the lanes can change.',
      provisional: true,
      rows: [
        { lane: 1, teamId: 101, teamName: 'Alpha', bibColour: 'Red' },
        { lane: 2, teamId: 201, teamName: 'Gamma', bibColour: undefined },
      ],
    });

    // Also works without lanesPerHeat cap
    const uncapped = nextRoundLanes(session(1, { lanesPerHeat: null, heats: [q1, q2, finalHeat] }), q1, null, 2, new Set([103]));
    expect(uncapped?.rows.map((r) => r.teamName)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  it('returns drawn final entries and next-heat lanes after the final is complete', () => {
    const q1 = heat(1, { orderIndex: 1, raceRoundId: 10, raceRoundStage: 1, races: [race(1, { isComplete: true })] });
    const q2 = heat(2, { orderIndex: 2, raceRoundId: 10, raceRoundStage: 1, races: [race(2, { isComplete: true })] });
    const finalHeat = heat(3, {
      orderIndex: 3,
      raceRoundId: 10,
      raceRoundStage: 2,
      label: 'Final A',
      entries: [
        { id: 20, teamId: 2, teamName: 'Two', laneIndex: 1, bibColour: 'Blue' },
        { id: 10, teamId: 1, teamName: 'One', laneIndex: 1, bibColour: 'Green' },
      ],
      races: [race(3, { isComplete: true })],
    });
    const followingHeat = heat(4, {
      orderIndex: 4,
      label: null,
      entries: [{ id: 30, teamId: 3, teamName: 'Three', laneIndex: 1 }],
      races: [race(4, { isComplete: false })],
    });
    const s = session(1, { heats: [q1, q2, finalHeat, followingHeat] });

    const finalLanes = nextRoundLanes(s, q1, finalHeat, 2);
    expect(finalLanes?.title).toBe('Lanes for Final A');
    expect(finalLanes?.rows.map((r) => r.teamName)).toEqual(['One', 'Two']);

    const afterFinal = nextRoundLanes(s, finalHeat, followingHeat, 2);
    expect(afterFinal?.title).toBe('Lanes for the next heat');
    expect(afterFinal?.rows.map((r) => r.teamName)).toEqual(['Three']);

    expect(nextRoundLanes(s, finalHeat, null, 2)).toBeNull();
  });
});
