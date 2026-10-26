import { describe, expect, it } from 'vitest';
import { changeArenas, resizeArenas, setSectionArena } from './creatorArenas';
import {
  arenaOf, arenasFromSections, defaultArena, defaultDraft, defaultSection, finalCountOf, lanesOfArena, MAX_ARENA_LANES, MAX_ARENAS, MAX_FINALS, MIN_ARENA_LANES,
  readDraft, resizeSessions, validateStep, type CreatorDraft,
} from './creatorDraft';

const draft = (extra: Partial<CreatorDraft> = {}): CreatorDraft => ({ ...defaultDraft(new Date(2026, 9, 31)), name: 'Zone', ...extra });

describe('arenas in a draft', () => {
  it('starts with one arena of six lanes, and reads arenas back from a stored draft', () => {
    expect(defaultDraft().arenas).toEqual([{ name: 'Main arena', lanes: '6' }]);
    expect(defaultArena(2)).toEqual({ name: 'Arena 3', lanes: '6' });
    const read = readDraft({ name: 'x', sections: [], arenas: [{ name: 'Ring A', lanes: '8' }, { lanes: 4 }, 'nope'] })!;
    expect(read.arenas).toEqual([{ name: 'Ring A', lanes: '8' }, { name: 'Arena 2', lanes: '6' }, { name: 'Arena 3', lanes: '6' }]);
    expect(readDraft({ name: 'x', sections: [], arenas: Array.from({ length: 9 }, () => ({})) })!.arenas).toHaveLength(MAX_ARENAS);
  });

  it('works the arenas out from the age groups of an older draft', () => {
    const sections = [{ ...defaultSection(), arena: 'Ring A', maxTeamsPerHeat: '8' }, { ...defaultSection(), arena: 'Ring A', maxTeamsPerHeat: '10' }, { ...defaultSection(), arena: ' ', maxTeamsPerHeat: '1' }];
    expect(readDraft({ name: 'x', sections })!.arenas).toEqual([{ name: 'Ring A', lanes: '10' }, { name: 'Main arena', lanes: '2' }]);
    expect(arenasFromSections([])).toEqual([{ name: 'Main arena', lanes: '6' }]);
  });

  it('finds the arena an age group runs in, falling back to the first', () => {
    const d = draft({ arenas: [{ name: 'A', lanes: '4' }, { name: 'B', lanes: '30' }] });
    expect(arenaOf(d, { arena: 'B' }).name).toBe('B');
    expect(arenaOf(d, { arena: 'Gone' }).name).toBe('A');
    expect(arenaOf({ arenas: [] }, { arena: 'x' }).name).toBe('Main arena');
    expect(lanesOfArena({ name: 'B', lanes: '30' })).toBe(MAX_ARENA_LANES);
    expect(lanesOfArena({ name: 'B', lanes: '' })).toBe(6);
    expect(lanesOfArena({ name: 'B', lanes: '1' })).toBe(MIN_ARENA_LANES);
  });

  it('needs every arena named once', () => {
    const d = draft({ arenas: [{ name: 'A', lanes: '6' }, { name: ' ', lanes: '6' }, { name: 'a', lanes: '6' }] });
    expect(validateStep(d, 'arenas')).toEqual({ 'arena.1.name': 'Give the arena a name.', 'arena.2.name': 'Two arenas have the same name.' });
    expect(validateStep(draft(), 'arenas')).toEqual({});
  });
});

describe('changing the arenas', () => {
  const two = draft({
    arenas: [{ name: 'Main arena', lanes: '6' }, { name: 'Ring B', lanes: '4' }],
    sections: [{ ...defaultSection(), arena: 'Main arena' }, { ...defaultSection(), ageGroup: 'Open', arena: 'Ring B', maxTeamsPerHeat: '4' }],
  });

  it('takes age groups along when an arena is renamed', () => {
    const out = changeArenas(two, [{ name: 'Big ring', lanes: '6' }, two.arenas[1]]);
    expect(out.sections.map((s) => s.arena)).toEqual(['Big ring', 'Ring B']);
  });

  it('gives an arena’s age groups heats of its new size', () => {
    const out = changeArenas(two, [{ name: 'Main arena', lanes: '8' }, two.arenas[1]]);
    expect(out.sections.map((s) => s.maxTeamsPerHeat)).toEqual(['8', '4']);
  });

  it('leaves the size of an age group that has heats alone', () => {
    const locked = { ...two, sections: [{ ...two.sections[0], sessions: [{ races: null, hasHeats: true }] }, two.sections[1]] };
    expect(changeArenas(locked, [{ name: 'Main arena', lanes: '8' }, locked.arenas[1]]).sections[0].maxTeamsPerHeat).toBe('6');
  });

  it('hands the age groups of a removed arena to the first one, with heats that fit', () => {
    const out = resizeArenas({ ...two, sections: [two.sections[0], { ...two.sections[1], maxTeamsPerHeat: '12' }, { ...two.sections[1], ageGroup: 'Juniors', arena: 'Ring B', maxTeamsPerHeat: 'x' }] }, 1);
    expect(out.arenas).toEqual([{ name: 'Main arena', lanes: '6' }]);
    expect(out.sections.map((s) => [s.arena, s.maxTeamsPerHeat])).toEqual([['Main arena', '6'], ['Main arena', '6'], ['Main arena', '6']]);
  });

  it('adds arenas with names that are free, up to four', () => {
    const named = draft({ arenas: [{ name: 'Main arena', lanes: '6' }, { name: 'Arena 3', lanes: '6' }] });
    expect(resizeArenas(named, 3).arenas.map((a) => a.name)).toEqual(['Main arena', 'Arena 3', 'Arena 4']);
    expect(resizeArenas(draft(), 99).arenas).toHaveLength(MAX_ARENAS);
    expect(resizeArenas(two, 0).arenas).toHaveLength(1);
    expect(resizeArenas(two, Number.NaN).arenas).toHaveLength(1);
  });

  it('keeps an age group in an arena that is no longer listed in the first arena', () => {
    const stray = draft({ arenas: [{ name: 'Main arena', lanes: '5' }], sections: [{ ...defaultSection(), arena: 'Somewhere' }] });
    expect(changeArenas(stray, stray.arenas).sections[0]).toMatchObject({ arena: 'Main arena', maxTeamsPerHeat: '5' });
    expect(changeArenas(stray, []).sections[0].arena).toBe('Somewhere');
  });

  it('puts one age group in another arena with heats no bigger than its lanes', () => {
    const out = setSectionArena(two, 0, 'Ring B');
    expect(out[0]).toMatchObject({ arena: 'Ring B', maxTeamsPerHeat: '4' });
    expect(out[1]).toBe(two.sections[1]);
    expect(setSectionArena(two, 0, 'Nowhere')).toBe(two.sections);
    const locked = { ...two, sections: [{ ...two.sections[0], sessions: [{ races: null, scored: true }] }, two.sections[1]] };
    expect(setSectionArena(locked, 0, 'Ring B')[0]).toMatchObject({ arena: 'Ring B', maxTeamsPerHeat: '6' });
    expect(setSectionArena({ ...two, sections: [{ ...two.sections[0], maxTeamsPerHeat: 'x' }, two.sections[1]] }, 0, 'Ring B')[0].maxTeamsPerHeat).toBe('4');
  });
});

describe('finals', () => {
  it('has one final for each heat of entries, from one to three, and none without a final', () => {
    const s = { ...defaultSection(), maxParticipants: '12', maxTeamsPerHeat: '6' };
    expect(finalCountOf(s)).toBe(2);
    expect(finalCountOf({ ...s, maxParticipants: '6' })).toBe(1);
    expect(finalCountOf({ ...s, maxParticipants: '' })).toBe(1);
    expect(finalCountOf({ ...s, maxParticipants: '60' })).toBe(MAX_FINALS);
    expect(finalCountOf(s, 4)).toBe(3);
    expect(finalCountOf({ ...s, hasFinal: false })).toBe(0);
    expect(finalCountOf({ ...s, usesRaceFinals: true })).toBe(0);
  });
});

describe('what a stored draft keeps', () => {
  it('keeps how it began, the tie-break, lane order, B and C final races, following Session 1, and the passport check', () => {
    const read = readDraft({
      name: 'x', startFrom: 'copy', copiedFrom: 'Spring 2026', noHatbands: true, passportCheck: true,
      sections: [{ format: 2, ageGroup: 'Open', tieBreak: 2, laneRotation: 1, finalRacesB: ['Bending'], finalRacesC: [], sessions: [{ races: ['A'] }, { races: ['A'], sameAsFirst: true }] }],
    })!;
    expect(read).toMatchObject({ startFrom: 'copy', copiedFrom: 'Spring 2026', noHatbands: true, passportCheck: true });
    expect(read.sections[0]).toMatchObject({ tieBreak: 2, laneRotation: 1, finalRacesB: ['Bending'] });
    expect(read.sections[0].finalRacesC).toBeUndefined();
    expect(read.sections[0].sessions[1]).toEqual({ races: ['A'], sameAsFirst: true });
    const odd = readDraft({ name: 'x', startFrom: 'else', sections: [{ tieBreak: 9, laneRotation: -1, finalRacesB: 'no' }] })!;
    expect(odd.startFrom).toBeUndefined();
    expect(odd.sections[0].tieBreak).toBeUndefined();
    expect(odd.sections[0].laneRotation).toBeUndefined();
    expect(odd.sections[0].finalRacesB).toBeUndefined();
  });

  it('gives a new session the first session’s races, following them', () => {
    const base = { ...defaultSection(), sessions: [{ races: ['Bending'] }] };
    expect(resizeSessions(base, 2).sessions[1]).toEqual({ races: ['Bending'], sameAsFirst: true });
    expect(resizeSessions(defaultSection(), 2).sessions[1]).toEqual({ races: null, sameAsFirst: true });
  });
});
