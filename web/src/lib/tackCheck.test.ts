import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TACK_SECTORS, TACK_MODES, defaultRiderSlots, draftFromMarks, draftTotal, isScored, marksFromDraft,
  marksFromRiderGrid, parsePoints, riderGridFromMarks, riderGridTotal, riderRowTotal, sectorColumnTotal, sectorProblem, teamRiders,
} from './tackCheck';

describe('tack check helpers', () => {
  it('has the four default sectors and a label for every mode', () => {
    expect(DEFAULT_TACK_SECTORS).toEqual(['Saddle/Girth', 'Bridle/Bit', 'Rider Hat/Boots', 'Turnout']);
    expect(TACK_MODES.map((m) => m.mode)).toEqual([0, 1, 2]);
    expect([isScored(0), isScored(1), isScored(2)]).toEqual([false, true, true]);
  });

  it('checks sector names the way the API does', () => {
    expect(sectorProblem([])).toMatch(/between 1 and 12/);
    expect(sectorProblem(Array.from({ length: 13 }, (_, i) => `S${i}`))).toMatch(/between 1 and 12/);
    expect(sectorProblem(['Bit', '  '])).toMatch(/name/);
    expect(sectorProblem(['x'.repeat(61)])).toMatch(/up to 60/);
    expect(sectorProblem(['Bit', ' bit '])).toBe('Two sectors have the same name.');
    expect(sectorProblem(['Bit', 'Boots'])).toBeNull();
  });

  it('turns saved marks into a draft and back', () => {
    const sectors = [{ id: 1, name: 'Bit' }, { id: 2, name: 'Boots' }, { id: 3, name: 'Hat' }];
    const draft = draftFromMarks(sectors, [{ sectorId: 1, passed: true, points: null }, { sectorId: 2, passed: false, points: 4 }]);
    expect(draft).toEqual({ 1: { passed: 'pass', points: '' }, 2: { passed: 'fail', points: '4' }, 3: { passed: '', points: '' } });
    expect(marksFromDraft(draft, 10)).toEqual({ marks: [{ sectorId: 1, passed: true, points: null }, { sectorId: 2, passed: false, points: 4 }] });
    expect(marksFromDraft({ 1: { passed: '', points: '11' } }, 10)).toEqual({ problem: 'Points go from 0 to 10.' });
    expect(draftTotal({ 1: { passed: '', points: '3' }, 2: { passed: '', points: 'x' }, 3: { passed: '', points: '' } }, 10)).toBe(3);
  });

  it('reads points as whole numbers within the maximum', () => {
    expect(parsePoints(' ', 10)).toBeNull();
    expect(parsePoints('0', 10)).toBe(0);
    expect(parsePoints('10', 10)).toBe(10);
    expect(parsePoints('11', 10)).toBe('invalid');
    expect(parsePoints('2.5', 10)).toBe('invalid');
    expect(parsePoints('-1', 10)).toBe('invalid');
  });

  it('builds a per-rider grid from declared or default slots, sums rows/columns/team total, and validates cells', () => {
    expect(defaultRiderSlots(2)).toEqual(['Rider 1', 'Rider 2', 'Rider 3', 'Rider 4']);
    expect(defaultRiderSlots(1)).toEqual(['Rider 1', 'Rider 2']);
    expect(defaultRiderSlots(3)).toEqual(['Rider 1']);
    expect(teamRiders({ riders: ['Amy', 'Ben'] })).toEqual(['Amy', 'Ben']);
    expect(teamRiders({ riders: [] }, 1)).toEqual(['Rider 1', 'Rider 2']);

    const sectors = [{ id: 1, name: 'Bit' }, { id: 2, name: 'Boots' }, { id: 3, name: 'Hat' }];
    const grid = riderGridFromMarks(sectors, [
      { sectorId: 1, passed: null, points: 17, riderPoints: [8, 9] },
      { sectorId: 2, passed: null, points: 6 },
    ], 2);
    expect(grid).toEqual({ 1: ['8', '9'], 2: ['6', ''], 3: ['', ''] });
    expect(riderRowTotal(grid, 0, 10)).toBe(14);
    expect(riderRowTotal(grid, 1, 10)).toBe(9);
    expect(sectorColumnTotal(grid, 1, 10)).toBe(17);
    expect(sectorColumnTotal(grid, 2, 10)).toBe(6);
    expect(sectorColumnTotal(grid, 99, 10)).toBe(0);
    expect(riderGridTotal(grid, 10)).toBe(23);
    expect(marksFromRiderGrid(grid, 10)).toEqual({
      marks: [
        { sectorId: 1, passed: null, points: 17, riderPoints: [8, 9] },
        { sectorId: 2, passed: null, points: 6, riderPoints: [6, null] },
      ],
    });
    expect(marksFromRiderGrid({ 1: ['11', '4'] }, 10)).toEqual({ problem: 'Points go from 0 to 10.' });
  });
});
