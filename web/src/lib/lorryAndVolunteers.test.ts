import { describe, expect, it } from 'vitest';
import { competitionUpdateBody } from './competitionPayload';
import {
  cleanWhat3Words,
  filterEmergencyContacts,
  filterVolunteerShifts,
  lorryGateLinks,
  telHref,
  VOLUNTEER_ROLE_PRESETS,
  volunteerShiftSummary,
} from './lorryAndVolunteers';
import type { CompetitionDetail, EmergencyContactEntry, VolunteerShift } from '../types';

describe('lorryAndVolunteers helpers', () => {
  it('cleans what3words addresses and builds lorry gate links', () => {
    expect(cleanWhat3Words(null)).toBeNull();
    expect(cleanWhat3Words('   ')).toBeNull();
    expect(cleanWhat3Words('///')).toBeNull();
    expect(cleanWhat3Words('///horses.arena.gate ')).toBe('horses.arena.gate');

    const empty = lorryGateLinks({});
    expect(empty).toEqual({
      hasDirections: false,
      what3WordsDisplay: null,
      what3WordsUrl: null,
      googleMapsUrl: null,
      appleMapsUrl: null,
      directionsNote: null,
    });

    const full = lorryGateLinks({
      lorryWhat3Words: '///horses.arena.gate',
      lorryLatitude: 52.2569,
      lorryLongitude: -1.5398,
      lorryDirectionsNote: '  Do NOT turn down Mill Lane — approach via A47 north gate  ',
    });
    expect(full).toEqual({
      hasDirections: true,
      what3WordsDisplay: '///horses.arena.gate',
      what3WordsUrl: 'https://what3words.com/horses.arena.gate',
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=52.2569,-1.5398',
      appleMapsUrl: 'https://maps.apple.com/?ll=52.2569,-1.5398&q=Horsebox%20%26%20Lorry%20Gate',
      directionsNote: 'Do NOT turn down Mill Lane — approach via A47 north gate',
    });
  });

  it('preserves lorry gate fields in competitionUpdateBody', () => {
    const base: CompetitionDetail = {
      id: 5,
      name: 'Spring Open',
      startDate: '2026-05-01T09:00:00Z',
      isActive: true,
      isArchived: false,
      sections: [],
      teams: [],
      sessions: [],
      lorryWhat3Words: 'horses.arena.gate',
      lorryLatitude: 52.25,
      lorryLongitude: -1.54,
      lorryDirectionsNote: 'North gate only',
    };
    const body = competitionUpdateBody(base, { lorryDirectionsNote: 'Use Gate B' });
    expect(body.lorryWhat3Words).toBe('horses.arena.gate');
    expect(body.lorryLatitude).toBe(52.25);
    expect(body.lorryLongitude).toBe(-1.54);
    expect(body.lorryDirectionsNote).toBe('Use Gate B');
  });

  it('filters volunteer shifts and summarises slot counts', () => {
    expect(VOLUNTEER_ROLE_PRESETS).toContain('Ring Crew');
    const shifts: VolunteerShift[] = [
      {
        id: 1,
        competitionId: 7,
        arenaName: 'Main Arena',
        role: 'Ring Crew',
        requiredCount: 3,
        claimedCount: 1,
        remainingCount: 2,
        isFilled: false,
        claims: [],
      },
      {
        id: 2,
        competitionId: 7,
        arenaName: 'Second Arena',
        role: 'Line Judge',
        requiredCount: 1,
        claimedCount: 1,
        remainingCount: 0,
        isFilled: true,
        claims: [],
      },
    ];

    expect(filterVolunteerShifts(shifts)).toHaveLength(2);
    expect(filterVolunteerShifts(shifts, { unfilledOnly: true }).map((s) => s.id)).toEqual([1]);
    expect(filterVolunteerShifts(shifts, { arenaName: ' second arena ' }).map((s) => s.id)).toEqual([2]);
    expect(filterVolunteerShifts([{ ...shifts[0], arenaName: null }], { arenaName: 'Main Arena' })).toEqual([]);
    expect(volunteerShiftSummary(shifts)).toEqual({
      totalShifts: 2,
      unfilledShifts: 1,
      totalSlots: 4,
      claimedSlots: 2,
      openSlots: 2,
    });
  });

  it('formats tel: links and filters emergency contact entries', () => {
    expect(telHref(null)).toBeNull();
    expect(telHref('   ')).toBeNull();
    expect(telHref('---')).toBeNull();
    expect(telHref('07700 900 123')).toBe('tel:07700900123');
    expect(telHref('+44 (0) 7700 900123')).toBe('tel:+4407700900123');

    const entries: EmergencyContactEntry[] = [
      {
        riderEntryId: 10,
        riderName: 'Olivia Hart',
        ponyName: 'Misty',
        teamId: 1,
        teamName: 'Oak Hunt A',
        sectionId: 2,
        sectionName: 'Under 12 Teams',
        clubName: 'Oak Hunt',
        bibColour: 'Red',
        bibDescription: 'Red with white star',
        isReserve: false,
        emergencyContactName: 'Sarah Hart',
        emergencyContactPhone: '07700 900111',
        medicalNotes: 'Penicillin allergy',
        trainerName: 'Jamie Carter',
        trainerPhone: '07700 900123',
      },
      {
        riderEntryId: 11,
        riderName: 'Theo Lane',
        ponyName: 'Rocket',
        teamId: 2,
        teamName: 'Elm Vale A',
        sectionId: 2,
        sectionName: 'Under 12 Teams',
        clubName: 'Elm Vale',
        bibColour: 'Blue',
        bibDescription: null,
        isReserve: true,
        emergencyContactName: 'Mark Lane',
        emergencyContactPhone: '07700 900222',
        medicalNotes: null,
        trainerName: 'Robin Page',
        trainerPhone: '07700 900456',
      },
    ];

    expect(filterEmergencyContacts(entries, '')).toHaveLength(2);
    expect(filterEmergencyContacts(entries, '   ')).toHaveLength(2);
    expect(filterEmergencyContacts(entries, 'misty').map((e) => e.riderEntryId)).toEqual([10]);
    expect(filterEmergencyContacts(entries, 'red star').map((e) => e.riderEntryId)).toEqual([10]);
    expect(filterEmergencyContacts(entries, 'elm blue').map((e) => e.riderEntryId)).toEqual([11]);
    expect(filterEmergencyContacts(entries, 'robin rocket').map((e) => e.riderEntryId)).toEqual([11]);
    expect(filterEmergencyContacts(entries, 'nonexistent')).toEqual([]);
  });
});
