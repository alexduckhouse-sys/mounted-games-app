import { describe, expect, it } from 'vitest';
import { heat } from '../test/factories';
import { bibName, inLaneOrder } from './laneOrder';
import { LaneRotationMode } from './lanes';

const names = (list: { teamName: string }[]) => list.map((e) => e.teamName);

describe('inLaneOrder', () => {
  // Drawn lanes: B 1, A 2, C 3 (listed out of order on purpose).
  const h = heat(1, { entries: [
    { id: 1, teamId: 1, teamName: 'A', laneIndex: 2 },
    { id: 2, teamId: 2, teamName: 'B', laneIndex: 1 },
    { id: 3, teamId: 3, teamName: 'C', laneIndex: 3 },
  ] });

  it('lists the drawn lanes in order for the first race', () => {
    expect(names(inLaneOrder(h, 0, { lanesPerHeat: null, mode: LaneRotationMode.MoveUp }))).toEqual(['B', 'A', 'C']);
  });

  it('follows the rotated lane in later races', () => {
    expect(names(inLaneOrder(h, 1, { lanesPerHeat: null, mode: LaneRotationMode.MoveUp }))).toEqual(['C', 'B', 'A']);
    expect(names(inLaneOrder(h, 1, { lanesPerHeat: null, mode: LaneRotationMode.MoveDown }))).toEqual(['A', 'C', 'B']);
    expect(names(inLaneOrder(h, 1, { lanesPerHeat: null, mode: LaneRotationMode.Stay }))).toEqual(['B', 'A', 'C']);
  });

  it('puts the team sitting out after the lane holders', () => {
    expect(names(inLaneOrder(h, 0, { lanesPerHeat: 2, mode: LaneRotationMode.MoveUp }))).toEqual(['B', 'A', 'C']);
    expect(names(inLaneOrder(h, 1, { lanesPerHeat: 2, mode: LaneRotationMode.MoveUp }))).toEqual(['C', 'B', 'A']);
    expect(names(inLaneOrder(h, 2, { lanesPerHeat: 2, mode: LaneRotationMode.MoveUp }))).toEqual(['A', 'C', 'B']);
  });

  it('treats a negative race index as the first race and leaves the heat alone', () => {
    const before = h.entries.map((e) => e.id);
    expect(names(inLaneOrder(h, -1, { lanesPerHeat: null, mode: LaneRotationMode.MoveUp }))).toEqual(['B', 'A', 'C']);
    expect(h.entries.map((e) => e.id)).toEqual(before);
  });
});

describe('bibName', () => {
  it('names the colour or says none is set', () => {
    expect(bibName(' Red ')).toBe('Red bib');
    expect(bibName(null)).toBe('No bib colour');
    expect(bibName('  ')).toBe('No bib colour');
  });
});
