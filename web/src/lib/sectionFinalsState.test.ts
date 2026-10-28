import { describe, expect, it } from 'vitest';
import { heat, race, session } from '../test/factories';
import { sectionFinalsState } from './toplist';

const finalHeat = (id: number, complete: boolean) => heat(id, { label: 'A Final', races: [race(id * 10, { isComplete: complete })] });
const qualifying = (id: number, complete: boolean) => heat(id, { label: `Heat ${id}`, races: [race(id * 10, { isComplete: complete })] });

describe('sectionFinalsState', () => {
  it('tells qualifying, finals under way and finals done apart, for one age group', () => {
    const mid = [session(1, { competitionSectionId: 5, heats: [qualifying(1, true), qualifying(2, false)] }), session(2, { competitionSectionId: 5, heats: [finalHeat(3, false)] })];
    expect(sectionFinalsState(mid, 5)).toEqual({ hasFinals: true, qualifyingDone: false, finalsStarted: false, finalsDone: false });
    const before = [session(1, { competitionSectionId: 5, heats: [qualifying(1, true)] }), session(2, { competitionSectionId: 5, heats: [finalHeat(3, false)] })];
    expect(sectionFinalsState(before, 5)).toEqual({ hasFinals: true, qualifyingDone: true, finalsStarted: false, finalsDone: false });
    const under = [before[0], session(2, { competitionSectionId: 5, heats: [finalHeat(3, true), finalHeat(4, false)] })];
    expect(sectionFinalsState(under, 5)).toEqual({ hasFinals: true, qualifyingDone: true, finalsStarted: true, finalsDone: false });
    const done = [before[0], session(2, { competitionSectionId: 5, heats: [finalHeat(3, true), finalHeat(4, true)] })];
    expect(sectionFinalsState(done, 5).finalsDone).toBe(true);
    expect(sectionFinalsState(done, 6)).toEqual({ hasFinals: false, qualifyingDone: false, finalsStarted: false, finalsDone: false });
  });

  it('has no finals to wait for in an age group without them, and ignores breaks', () => {
    const noFinals = [session(1, { competitionSectionId: 5, heats: [qualifying(1, true)] })];
    expect(sectionFinalsState(noFinals, 5)).toMatchObject({ hasFinals: false, finalsDone: false, qualifyingDone: true });
    const brk = [session(9, { competitionSectionId: 5, isBreak: true, kind: 1, heats: [finalHeat(7, false)] })];
    expect(sectionFinalsState(brk, 5).hasFinals).toBe(false);
  });
});
