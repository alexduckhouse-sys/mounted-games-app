import { describe, expect, it } from 'vitest';
import { defaultSection, type SectionDraft } from '../../../lib/creatorDraft';
import { finalListsOf } from './save';

const section = (over: Partial<SectionDraft>): SectionDraft => ({ ...defaultSection(), ...over });

describe('finalListsOf', () => {
  it('returns the B and C lists for the finals the age group has', () => {
    const s = section({ maxParticipants: '20', maxTeamsPerHeat: '6', finalRacesB: ['Mug'], finalRacesC: ['Relay'] });
    expect(finalListsOf(s)).toEqual({ B: ['Mug'], C: ['Relay'] });
  });

  it('leaves out lists for finals that do not exist, and empty lists', () => {
    expect(finalListsOf(section({ maxParticipants: '12', maxTeamsPerHeat: '6', finalRacesB: ['Mug'], finalRacesC: ['Relay'] }))).toEqual({ B: ['Mug'] });
    expect(finalListsOf(section({ maxParticipants: '6', maxTeamsPerHeat: '6', finalRacesB: ['Mug'] }))).toEqual({});
    expect(finalListsOf(section({ maxParticipants: '20', maxTeamsPerHeat: '6', finalRacesB: [], finalRacesC: null }))).toEqual({});
  });

  it('is empty when the age group has no final', () => {
    expect(finalListsOf(section({ hasFinal: false, maxParticipants: '20', maxTeamsPerHeat: '6', finalRacesB: ['Mug'] }))).toEqual({});
  });
});
