import { describe, expect, it } from 'vitest';
import { defaultSection, type SectionDraft } from './creatorDraft';
import {
  dropIndex, followsFirst, isFinalKey, isKeyLocked, makeRoom, moveItem, raceKeyLabel, raceKeys, raceLists, racesOf, withFollowsFirst, withRaces,
} from './creatorRaces';

const section = (extra: Partial<SectionDraft> = {}): SectionDraft => ({
  ...defaultSection(), maxParticipants: '12', maxTeamsPerHeat: '6',
  sessions: [{ races: ['A', 'B'] }, { races: null }], ...extra,
});

describe('the tabs of an age group', () => {
  it('lists a tab for each session and then each final, A to C', () => {
    expect(raceKeys(section())).toEqual([1, 2, 'f', 'fB']);
    expect(raceKeys(section({ maxParticipants: '6' }))).toEqual([1, 2, 'f']);
    expect(raceKeys(section({ maxParticipants: '60' }))).toEqual([1, 2, 'f', 'fB', 'fC']);
    expect(raceKeys(section({ hasFinal: false }))).toEqual([1, 2]);
    expect(raceKeys(section({ usesRaceFinals: true }))).toEqual([1, 2]);
    expect(raceKeys(section(), 4)).toEqual([1, 2, 'f', 'fB', 'fC']);
  });

  it('names them', () => {
    expect(raceKeyLabel(2, 2)).toBe('Session 2');
    expect(raceKeyLabel('f', 1)).toBe('Final');
    expect(raceKeyLabel('f', 2)).toBe('A final');
    expect(raceKeyLabel('fB', 2)).toBe('B final');
    expect(raceKeyLabel('fC', 3)).toBe('C final');
    expect(isFinalKey('f')).toBe(true);
    expect(isFinalKey(1)).toBe(false);
  });

  it('reads the list on a tab', () => {
    const s = section({ finalRaces: ['F'], finalRacesB: ['G'] });
    expect(racesOf(s, 1)).toEqual(['A', 'B']);
    expect(racesOf(s, 2)).toBeNull();
    expect(racesOf(s, 9)).toBeNull();
    expect(racesOf(s, 'f')).toEqual(['F']);
    expect(racesOf(s, 'fB')).toEqual(['G']);
    expect(racesOf(s, 'fC')).toBeNull();
  });

  it('lists every tab for the review, saying which follow Session 1', () => {
    const s = section({ sessions: [{ races: ['A'] }, { races: ['A'], sameAsFirst: true }] });
    expect(raceLists(s)).toEqual([
      { key: 1, label: 'Session 1', races: ['A'], same: false },
      { key: 2, label: 'Session 2', races: ['A'], same: true },
      { key: 'f', label: 'A final', races: null, same: false },
      { key: 'fB', label: 'B final', races: null, same: false },
    ]);
    expect(raceLists(section({ maxParticipants: '6' })).map((l) => l.label)).toEqual(['Session 1', 'Session 2', 'Final']);
    expect(raceLists(section(), 4).map((l) => l.label)).toContain('C final');
  });
});

describe('changing a list', () => {
  it('sets a session’s list, and empty means left for later', () => {
    expect(withRaces(section(), 2, ['X']).sessions[1].races).toEqual(['X']);
    expect(withRaces(section(), 1, []).sessions[0].races).toBeNull();
    expect(withRaces(section(), 1, null).sessions[0].races).toBeNull();
  });

  it('sets the final lists', () => {
    expect(withRaces(section(), 'f', ['X']).finalRaces).toEqual(['X']);
    expect(withRaces(section(), 'fB', ['Y']).finalRacesB).toEqual(['Y']);
    expect(withRaces(section(), 'fC', ['Z']).finalRacesC).toEqual(['Z']);
    expect(withRaces(section({ finalRaces: ['X'] }), 'f', null).finalRaces).toBeNull();
  });

  it('passes Session 1’s list on to the sessions that follow it', () => {
    const s = section({ sessions: [{ races: ['A'] }, { races: ['A'], sameAsFirst: true }, { races: ['Own'] }] });
    const out = withRaces(s, 1, ['A', 'B']);
    expect(out.sessions.map((x) => x.races)).toEqual([['A', 'B'], ['A', 'B'], ['Own']]);
    expect(withRaces(s, 3, ['New']).sessions.map((x) => x.races)).toEqual([['A'], ['A'], ['New']]);
  });

  it('turns following on, copying the list now, and off, keeping it', () => {
    const on = withFollowsFirst(section(), 2, true);
    expect(on.sessions[1]).toEqual({ races: ['A', 'B'], sameAsFirst: true });
    expect(followsFirst(on, 2)).toBe(true);
    expect(followsFirst(on, 1)).toBe(false);
    expect(followsFirst(on, 'f')).toBe(false);
    const off = withFollowsFirst(on, 2, false);
    expect(off.sessions[1]).toEqual({ races: ['A', 'B'], sameAsFirst: false });
    expect(followsFirst(off, 2)).toBe(false);
  });

  it('leaves a list alone once its heats are made or it has been scored', () => {
    const s = section({ sessions: [{ races: ['A'], hasHeats: true }, { races: null }], finalHasHeats: true });
    expect(isKeyLocked(s, 1)).toBe(true);
    expect(isKeyLocked(s, 2)).toBe(false);
    expect(isKeyLocked(s, 9)).toBe(false);
    expect(isKeyLocked(s, 'f')).toBe(true);
    expect(isKeyLocked(s, 'fB')).toBe(false);
    expect(isKeyLocked(section({ finalScored: true }), 'f')).toBe(true);
    expect(withRaces(s, 1, ['X'])).toBe(s);
    expect(withRaces(s, 'f', ['X'])).toBe(s);
    expect(withFollowsFirst(section({ sessions: [{ races: ['A'] }, { races: null, scored: true }] }), 2, true).sessions[1]).toEqual({ races: null, scored: true });
    // A locked session that follows Session 1 is not changed when Session 1 is.
    const follower = section({ sessions: [{ races: ['A'] }, { races: ['A'], sameAsFirst: true, hasHeats: true }] });
    expect(withRaces(follower, 1, ['B']).sessions[1].races).toEqual(['A']);
  });
});

describe('putting races in order', () => {
  it('moves one item', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    const same = ['a', 'b'];
    expect(moveItem(same, 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(same, 1, 1)).not.toBe(same);
    expect(moveItem(same, -1, 0)).toEqual(['a', 'b']);
    expect(moveItem(same, 0, 2)).toEqual(['a', 'b']);
    expect(moveItem(same, 5, 0)).toEqual(['a', 'b']);
  });

  it('says where a dragged row lands, within the list', () => {
    expect(dropIndex(2, 0, 56, 8)).toBe(2);
    expect(dropIndex(2, 60, 56, 8)).toBe(3);
    expect(dropIndex(2, 130, 56, 8)).toBe(4);
    expect(dropIndex(2, -120, 56, 8)).toBe(0);
    expect(dropIndex(2, -900, 56, 8)).toBe(0);
    expect(dropIndex(2, 900, 56, 8)).toBe(7);
    expect(dropIndex(2, 50, 0, 8)).toBe(2);
    expect(dropIndex(0, 50, 56, 0)).toBe(0);
  });

  it('makes room for it: the rows it passes move out of its way', () => {
    // Row 1 dragged down to 3: rows 2 and 3 move up a row.
    expect([0, 1, 2, 3, 4].map((i) => makeRoom(i, 1, 3, 56))).toEqual([0, 0, -56, -56, 0]);
    // Row 3 dragged up to 1: rows 1 and 2 move down.
    expect([0, 1, 2, 3, 4].map((i) => makeRoom(i, 3, 1, 56))).toEqual([0, 56, 56, 0, 0]);
    expect([0, 1, 2].map((i) => makeRoom(i, 1, 1, 56))).toEqual([0, 0, 0]);
  });
});
