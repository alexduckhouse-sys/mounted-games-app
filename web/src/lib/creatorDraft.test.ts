import { describe, expect, it } from 'vitest';
import {
  defaultDraft, defaultSection, finalistCountOf, finalSessionName, firstProblemStep, hatbandsFor, laneCount, isLocked, MAX_SESSIONS, minutesOf, heatSizeOf, newSessionName, parseFinalistCount, parseMaxParticipants,
  priceGbpToMinor, readDraft, resizeSessions, sectionLocked, sectionName, setFormat, setRaceFinals, STEP_IDS, validateStep, wholeNumber,
  type CreatorDraft,
} from './creatorDraft';

const draft = (extra: Partial<CreatorDraft> = {}): CreatorDraft => ({ ...defaultDraft(new Date(2026, 9, 31)), name: 'Zone', ...extra });

describe('defaults and names', () => {
  it('starts with one Seniors teams section and one session', () => {
    const d = defaultDraft(new Date('2026-10-31T10:00:00Z'));
    expect(d.sections).toHaveLength(1);
    expect(d.sections[0]).toMatchObject({ format: 2, ageGroup: 'Seniors', minutesPerRace: '10', maxTeamsPerHeat: '6' });
    expect(d.startDate).toBe('2026-10-31');
    expect(sectionName(d.sections[0])).toBe('Senior Teams');
  });

  it('names sessions after the section, numbering them when there are several', () => {
    const one = defaultSection();
    expect(newSessionName(one, 0)).toBe('Senior Teams');
    const two = resizeSessions(one, 2);
    expect(newSessionName(two, 1)).toBe('Senior Teams · Session 2');
    expect(finalSessionName(one)).toBe('Finals · Senior Teams');
  });
});

describe('structure helpers', () => {
  it('resizes sessions within 1 to 6 and never drops a locked one', () => {
    const base = defaultSection();
    expect(resizeSessions(base, 3).sessions).toHaveLength(3);
    expect(resizeSessions(base, 99).sessions).toHaveLength(MAX_SESSIONS);
    expect(resizeSessions(resizeSessions(base, 3), 0).sessions).toHaveLength(1);
    expect(resizeSessions(base, Number.NaN).sessions).toHaveLength(1);
    const locked = { ...base, sessions: [{ races: null }, { races: null, hasHeats: true }] };
    expect(resizeSessions(locked, 1).sessions).toHaveLength(2);
    expect(sectionLocked(locked)).toBe(true);
    expect(isLocked({ races: null, scored: true })).toBe(true);
    expect(sectionLocked(base)).toBe(false);
  });

  it('heat, heat, final uses one session; switching it off keeps the count', () => {
    const three = resizeSessions(defaultSection(), 3);
    const hhf = setRaceFinals(three, true);
    expect(hhf.usesRaceFinals).toBe(true);
    expect(hhf.sessions).toHaveLength(1);
    expect(setRaceFinals(hhf, false).usesRaceFinals).toBe(false);
  });

  it('changes the heat size and default finalist count with the format only while they are the default', () => {
    expect(setFormat(defaultSection(), 1)).toMatchObject({ format: 1, maxTeamsPerHeat: '4' });
    expect(setFormat({ ...defaultSection(), finalistCount: '6' }, 1)).toMatchObject({ format: 1, maxTeamsPerHeat: '4', finalistCount: '4' });
    expect(setFormat({ ...defaultSection(), maxTeamsPerHeat: '5', finalistCount: '8' }, 1)).toMatchObject({ maxTeamsPerHeat: '5', finalistCount: '8' });
    expect(finalistCountOf(defaultSection())).toBe(6);
    expect(finalistCountOf(defaultSection(1))).toBe(4);
    expect(finalistCountOf({ ...defaultSection(), maxTeamsPerHeat: '5' })).toBe(5);
    expect(finalistCountOf({ ...defaultSection(), finalistCount: '12' })).toBe(12);
  });

  it('reads what was typed', () => {
    expect(priceGbpToMinor('12.50')).toBe(1250);
    expect(priceGbpToMinor('')).toBe(0);
    expect(priceGbpToMinor('-3')).toBe(0);
    expect(priceGbpToMinor('abc')).toBe(0);
    expect(parseMaxParticipants('24')).toBe(24);
    expect(parseMaxParticipants('0')).toBeNull();
    expect(parseMaxParticipants('')).toBeNull();
    expect(parseFinalistCount('6')).toBe(6);
    expect(parseFinalistCount('51')).toBeNull();
    expect(parseFinalistCount('')).toBeNull();
    expect(wholeNumber(' 12 ')).toBe(12);
    expect(wholeNumber('1e3')).toBeNull();
    expect(minutesOf({ ...defaultSection(), minutesPerRace: 'x' })).toBe(10);
    expect(heatSizeOf({ ...defaultSection(), format: 1, maxTeamsPerHeat: '' })).toBe(4);
  });
});

describe('validateStep', () => {
  it('needs a name on the first step', () => {
    expect(validateStep(draft({ name: ' ' }), 'about')).toEqual({ name: 'Enter a name.' });
    expect(validateStep(draft(), 'about')).toEqual({});
  });

  it('needs a start, and an end that is not before it', () => {
    expect(Object.keys(validateStep(draft({ startDate: '', startTime: '' }), 'when')).sort()).toEqual(['startDate', 'startTime']);
    expect(validateStep(draft({ startDate: '2026-10-31', endDate: '2026-10-30' }), 'when')).toHaveProperty('endDate');
    expect(validateStep(draft({ startDate: '2026-10-31', endDate: '2026-11-01' }), 'when')).toEqual({});
  });

  it('checks each section: an age group, no repeats, a sensible price and cap', () => {
    const a = { ...defaultSection(), ageGroup: ' ' };
    const b = { ...defaultSection(), ageGroup: 'Open', priceGbp: 'free', maxParticipants: '2.5' };
    const c = { ...defaultSection(), ageGroup: 'open', priceGbp: '5', maxParticipants: '20' };
    const problems = validateStep(draft({ sections: [a, b, c] }), 'sections');
    expect(problems['section.0.ageGroup']).toBe('Enter an age group.');
    expect(problems['section.1.price']).toBeDefined();
    expect(problems['section.1.max']).toBeDefined();
    expect(problems['section.2.ageGroup']).toBe('You already have this age group in this format.');
    expect(validateStep(draft({ sections: [{ ...defaultSection(), ageGroup: 'Open' }, { ...defaultSection(), format: 1, ageGroup: 'Open' }] }), 'sections')).toEqual({});
  });

  it('checks timing: minutes, heat size, finalists and arena', () => {
    const bad = { ...defaultSection(), minutesPerRace: '0', maxTeamsPerHeat: '25', finalistCount: '99', arena: ' ' };
    expect(Object.keys(validateStep(draft({ sections: [bad] }), 'structure')).sort()).toEqual([
      'section.0.arena', 'section.0.finalists', 'section.0.heat', 'section.0.minutes']);
    expect(validateStep(draft({ sections: [{ ...defaultSection(), minutesPerRace: '', maxTeamsPerHeat: 'six' }] }), 'structure')).toHaveProperty('section.0.minutes');
    expect(validateStep(draft(), 'structure')).toEqual({});
  });

  it('checks breaks on the review step, and lets races and payment through', () => {
    const brk = { kind: 1 as const, name: ' ', date: '', time: '', minutes: 'x', arena: '' };
    expect(Object.keys(validateStep(draft({ breaks: [brk] }), 'review')).sort()).toEqual(['break.0.minutes', 'break.0.name', 'break.0.time']);
    expect(validateStep(draft(), 'races')).toEqual({});
    expect(validateStep(draft(), 'payment')).toEqual({});
  });

  it('finds the first step with a problem', () => {
    expect(firstProblemStep(draft())).toBeNull();
    expect(firstProblemStep(draft({ name: '', startDate: '' }))).toBe('about');
    expect(firstProblemStep(draft({ startDate: '' }))).toBe('when');
    expect(firstProblemStep(draft({ sections: [{ ...defaultSection(), minutesPerRace: '0' }] }))).toBe('structure');
  });
});

describe('readDraft', () => {
  it('refuses anything that is not a draft', () => {
    for (const value of [null, 'x', 4, {}, { name: 'a' }, { name: 1, sections: [] }]) expect(readDraft(value)).toBeNull();
  });

  it('reads a full draft, keeping the step and ids', () => {
    const d = draft({ step: 3, savedAt: '2026-10-31T10:00:00Z' });
    d.sections = [{ ...defaultSection(), existingId: 7, hasEntries: true, finalRaces: ['Flag'], finalSessionId: 12, finalHasHeats: true, finalScored: true, sessions: [{ existingId: 9, name: 'A', races: ['Bending'], hasHeats: true, scored: true }] }];
    d.breaks = [{ existingId: 4, kind: 2, name: 'Briefing', date: '2026-10-31', time: '09:00', minutes: '15', arena: '' }];
    expect(readDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('upgrades a draft from the one-page editor without losing what it held', () => {
    const old = {
      name: 'Old', location: 'Field', startDate: '2026-11-01', startTime: '08:00', endDate: '', endTime: '17:00', step: 'review',
      sections: [{ format: 1, ageGroup: 'Juniors', priceGbp: '5', sessions: [{ name: 'a', races: 'Bending\nBottle', scope: 'Zone' }, { name: 'b', races: '', scope: 'Zone' }], minsPerHeat: 25, maxTeamsPerHeat: 6 }],
      teams: [],
    };
    const d = readDraft(old)!;
    expect(d.step).toBe(0);
    expect(d.name).toBe('Old');
    expect(d.location).toBe('Field');
    expect(d.sections[0]).toMatchObject({ format: 1, ageGroup: 'Juniors', priceGbp: '5', minutesPerRace: '10', maxTeamsPerHeat: '4' });
    expect(d.sections[0].sessions).toHaveLength(2);
    expect(d.sections[0].sessions[0].races).toBeNull();
    expect(d.breaks).toEqual([]);
  });

  it('copes with odd values: missing sessions, bad races, an empty section list, a step out of range', () => {
    const d = readDraft({ name: 'x', step: 99, sections: [{ format: 7, sessions: [], arena: '' }, { sessions: [null, { races: [1] }] }], breaks: [null] }, new Date(2026, 0, 2))!;
    expect(d.step).toBe(0);
    expect(d.sections[0]).toMatchObject({ format: 2, arena: 'Main arena' });
    expect(d.sections[0].sessions).toHaveLength(1);
    expect(d.sections[1].sessions).toEqual([{ races: null }, { races: null }]);
    expect(d.breaks).toEqual([{ kind: 1, name: '', date: '', time: '', minutes: '30', arena: '' }]);
    expect(readDraft({ name: 'x', sections: [] })!.sections).toHaveLength(1);
  });

  it('has a step id for every step', () => {
    expect(STEP_IDS).toHaveLength(8);
  });
});

describe('hatbands', () => {
  it('needs a lane for every team in the biggest heat, between 1 and 20', () => {
    expect(laneCount([defaultSection()])).toBe(6);
    expect(laneCount([defaultSection(), { ...defaultSection(), maxTeamsPerHeat: '8' }])).toBe(8);
    expect(laneCount([{ ...defaultSection(), format: 1, maxTeamsPerHeat: '' }])).toBe(4);
    expect(laneCount([{ ...defaultSection(), maxTeamsPerHeat: '99' }])).toBe(20);
    expect(laneCount([])).toBe(1);
  });

  it('uses the default order for lanes with no choice, and keeps what was chosen', () => {
    const d = draft({ laneHatbands: ['Pink', ' ', 'Teal'] });
    expect(hatbandsFor(d)).toEqual(['Pink', 'White', 'Teal', 'Yellow', 'Green', 'Black']);
    expect(hatbandsFor(draft({ sections: [{ ...defaultSection(), maxTeamsPerHeat: '10' }] }))).toHaveLength(10);
    expect(hatbandsFor(draft({ sections: [{ ...defaultSection(), maxTeamsPerHeat: '10' }] }))[8]).toBe('Red');
  });

  it('is read back from a stored draft, ignoring anything that is not text', () => {
    expect(readDraft({ name: 'x', sections: [], laneHatbands: ['Red', 4, 'Blue'] })!.laneHatbands).toEqual(['Red', 'Blue']);
    expect(readDraft({ name: 'x', sections: [], laneHatbands: 'no' })!.laneHatbands).toEqual([]);
  });
});
