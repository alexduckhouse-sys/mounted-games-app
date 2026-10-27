import { describe, expect, it } from 'vitest';
import { heat, race, session } from '../test/factories';
import { LaneRotationMode } from './lanes';
import { currentLanes, currentRaceIndex, finishingReview, lastLaneLeft, laneWords, raceLanes, racesInOrder } from './raceLanes';

// Drawn lanes: Test A 1, Test B 2, Test C 3.
const h = heat(1, {
  entries: [
    { id: 11, teamId: 1, teamName: 'Test A', laneIndex: 1 },
    { id: 12, teamId: 2, teamName: 'Test B', laneIndex: 2 },
    { id: 13, teamId: 3, teamName: 'Test C', laneIndex: 3 },
  ],
  races: [race(2, { orderIndex: 2 }), race(1, { orderIndex: 1, isComplete: true }), race(3, { orderIndex: 3 })],
});
const move = { lanesPerHeat: null, mode: LaneRotationMode.MoveUp };
const bands = ['Red', 'Lilac #B79CED', 'Blue'];

describe('race order', () => {
  it('runs the races by their order and finds the first one not complete', () => {
    expect(racesInOrder(h).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(currentRaceIndex(h)).toBe(1);
  });

  it('has no current race once all are done or when there are none', () => {
    expect(currentRaceIndex(heat(2, { races: [race(1, { isComplete: true })] }))).toBeNull();
    expect(currentRaceIndex(heat(3))).toBeNull();
  });
});

describe('raceLanes', () => {
  it('gives the rotated lane and the hatband of that lane for the race', () => {
    expect(raceLanes(h, 0, move, bands).map((l) => [l.entry.teamName, l.lane, l.hatband])).toEqual([
      ['Test A', '1', 'Red'], ['Test B', '2', 'Lilac #B79CED'], ['Test C', '3', 'Blue'],
    ]);
    expect(raceLanes(h, 1, move, bands).map((l) => [l.entry.teamName, l.lane, l.hatband])).toEqual([
      ['Test C', '1', 'Red'], ['Test A', '2', 'Lilac #B79CED'], ['Test B', '3', 'Blue'],
    ]);
  });

  it('gives a team sitting out no lane and no hatband', () => {
    const lanes = raceLanes(h, 0, { lanesPerHeat: 2, mode: LaneRotationMode.MoveUp }, bands);
    expect(lanes.at(-1)).toMatchObject({ lane: 'S', sitting: true, hatband: null });
  });

  it('treats a negative race as the first and copes with no hatbands', () => {
    expect(raceLanes(h, -1, move, null).map((l) => l.hatband)).toEqual([null, null, null]);
  });
});

describe('laneWords', () => {
  it('says the hatband name, the lane, or that the team sits out', () => {
    expect(laneWords({ lane: '2', sitting: false, hatband: 'Lilac #B79CED' })).toBe('Lilac');
    expect(laneWords({ lane: '2', sitting: false, hatband: null })).toBe('Lane 2');
    expect(laneWords({ lane: '2', sitting: false, hatband: '#B79CED' })).toBe('Custom colour');
    expect(laneWords({ lane: 'S', sitting: true, hatband: null })).toBe('Sits out');
  });
});

describe('finishingReview', () => {
  const lanes = raceLanes(h, 0, move, bands);

  it('lists placed teams by place, then teams that are out', () => {
    const lines = finishingReview(lanes, [
      { teamId: 3, place: 0, eliminated: true, status: 3 },
      { teamId: 2, place: 1, eliminated: false },
      { teamId: 1, place: 2, eliminated: false },
    ], new Set([1]));
    expect(lines.map((l) => l.text)).toEqual(['Lilac · Test B · 1st', 'Red · Test A · 2nd (HC)', 'Blue · Test C · Did not finish']);
    expect(lines.map((l) => l.short)).toEqual(['1st Test B', '2nd (HC) Test A', 'Did not finish Test C']);
    expect(lines.map((l) => l.out)).toEqual([false, false, true]);
  });

  it('keeps tied teams in lane order and leaves out teams not scored yet or sitting out', () => {
    const sitting = raceLanes(h, 0, { lanesPerHeat: 2, mode: LaneRotationMode.MoveUp }, bands);
    const lines = finishingReview(sitting, [
      { teamId: 2, place: 1, eliminated: false },
      { teamId: 1, place: 1, eliminated: false },
      { teamId: 3, place: 2, eliminated: false },
    ], new Set());
    expect(lines.map((l) => l.text)).toEqual(['Red · Test A · 1st', 'Lilac · Test B · 1st']);
    expect(finishingReview(lanes, [{ teamId: 1, place: 0, eliminated: false }], new Set())).toEqual([]);
  });

  it('orders two teams that are out by lane and names an old elimination', () => {
    const lines = finishingReview(lanes, [
      { teamId: 2, place: 0, eliminated: true },
      { teamId: 1, place: 0, eliminated: true, status: 99 },
    ], new Set());
    expect(lines.map((l) => l.text)).toEqual(['Red · Test A · Eliminated', 'Lilac · Test B · Eliminated']);
  });
});

describe('lastLaneLeft', () => {
  const lanes = raceLanes(h, 0, move, bands);

  it('picks the one team still to score', () => {
    expect(lastLaneLeft(lanes, [{ teamId: 1, place: 1, eliminated: false }, { teamId: 2, place: 0, eliminated: true }])).toBe(3);
  });

  it('counts points set by hand as scored', () => {
    expect(lastLaneLeft(lanes, [{ teamId: 1, place: 1, eliminated: false }], new Set([2]))).toBe(3);
  });

  it('picks nothing while two or more are left, once all are done, or with one racing lane', () => {
    expect(lastLaneLeft(lanes, [{ teamId: 1, place: 1, eliminated: false }])).toBeNull();
    expect(lastLaneLeft(lanes, [1, 2, 3].map((teamId) => ({ teamId, place: teamId, eliminated: false })))).toBeNull();
    const one = raceLanes(heat(4, { entries: [h.entries[0]] }), 0, move, bands);
    expect(lastLaneLeft(one, [])).toBeNull();
  });

  it('never picks a team sitting out', () => {
    const sitting = raceLanes(h, 0, { lanesPerHeat: 2, mode: LaneRotationMode.MoveUp }, bands);
    expect(lastLaneLeft(sitting, [{ teamId: 1, place: 1, eliminated: false }])).toBe(2);
    expect(lastLaneLeft(sitting, [{ teamId: 1, place: 1, eliminated: false }, { teamId: 2, place: 2, eliminated: false }])).toBeNull();
  });
});

describe('currentLanes', () => {
  it('uses the heat’s session rules and the race being run', () => {
    const now = currentLanes({ sessions: [session(1, { heats: [h] })], laneHatbands: bands }, h);
    expect(now?.raceName).toBe('Race 2');
    expect(now?.lanes.map((l) => l.entry.teamName)).toEqual(['Test C', 'Test A', 'Test B']);
  });

  it('starts from the first race of a heat with none, and gives nothing for a heat outside the event', () => {
    const empty = heat(9, { entries: h.entries });
    expect(currentLanes({ sessions: [session(1, { heats: [empty] })], laneHatbands: null }, empty)?.raceName).toBeNull();
    expect(currentLanes({ sessions: [], laneHatbands: null }, h)).toBeNull();
  });
});
