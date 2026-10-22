import { describe, expect, it } from 'vitest';
import { LANE_ROTATION_LABELS, LaneRotationMode, lanesInUse, laneLabel, positionFor, sitsOut } from './lanes';

describe('lane rotation', () => {
  it('moves each team up a lane per race and wraps round (the old behaviour, and the default)', () => {
    expect([0, 1, 2, 5].map((race) => positionFor(1, race, 6))).toEqual([1, 2, 3, 6]);
    expect(positionFor(6, 1, 6, LaneRotationMode.MoveUp)).toBe(1);
  });

  it('moves down a lane per race and wraps the other way', () => {
    expect(positionFor(1, 1, 6, LaneRotationMode.MoveDown)).toBe(6);
    expect(positionFor(4, 2, 6, LaneRotationMode.MoveDown)).toBe(2);
  });

  it('keeps teams in their drawn lane', () => {
    expect([0, 1, 5, 9].map((race) => positionFor(3, race, 6, LaneRotationMode.Stay))).toEqual([3, 3, 3, 3]);
  });

  it('leaves the lane alone for an empty heat', () => expect(positionFor(3, 4, 0)).toBe(3));

  it('uses the lane limit, or one lane per team without one', () => {
    expect(lanesInUse(7, 6)).toBe(6);
    expect(lanesInUse(4, 6)).toBe(4);
    expect(lanesInUse(5, null)).toBe(5);
    expect(lanesInUse(0, undefined)).toBe(1);
  });

  it('sits one team out of each race when seven teams share six lanes, and every team once in seven races', () => {
    for (const mode of [LaneRotationMode.MoveUp, LaneRotationMode.MoveDown]) {
      for (let team = 1; team <= 7; team += 1) {
        const sitOuts = Array.from({ length: 7 }, (_, race) => sitsOut(team, race, 7, 6, mode)).filter(Boolean).length;
        expect(sitOuts).toBe(1);
      }
      for (let race = 0; race < 7; race += 1) {
        expect(Array.from({ length: 7 }, (_, i) => sitsOut(i + 1, race, 7, 6, mode)).filter(Boolean)).toHaveLength(1);
      }
    }
  });

  it('shows S while a team sits out, and its lane otherwise', () => {
    expect(laneLabel(7, 0, 7, 6)).toBe('S');
    expect(laneLabel(7, 1, 7, 6)).toBe('1');
    expect(laneLabel(2, 0, 6, 6)).toBe('2');
  });

  it('never has anyone sit out when everyone has a lane', () => {
    expect(Array.from({ length: 6 }, (_, i) => sitsOut(i + 1, 3, 6, 6)).some(Boolean)).toBe(false);
  });

  it('names every rotation', () => expect(Object.keys(LANE_ROTATION_LABELS)).toHaveLength(3));
});
