import { describe, expect, it } from 'vitest';
import { DEFAULT_TACK_SECTORS, TACK_MODES, draftFromMarks, draftTotal, isScored, marksFromDraft, parsePoints, sectorProblem } from './tackCheck';

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
});
