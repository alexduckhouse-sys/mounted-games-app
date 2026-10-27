import { describe, expect, it } from 'vitest';
import {
  filterEmergencyContacts, isShiftCheckedInHere, isShiftMarkedMissing, missingStewardShifts, myTeamAssignedDuties,
  sessionStewardDutySummary, telHref,
} from './lorryAndVolunteers';
import type { EmergencyContactEntry, VolunteerShift } from '../types';

const shift = (over: Partial<VolunteerShift> = {}): VolunteerShift => ({
  id: 1, competitionId: 1, role: 'Steward', requiredCount: 1, claimedCount: 0, remainingCount: 1, isFilled: false, claims: [], ...over,
});

const contact = (over: Partial<EmergencyContactEntry> = {}): EmergencyContactEntry => ({
  riderEntryId: 1, riderName: 'Alice Brown', teamId: 1, teamName: 'Kent A', sectionId: 1, sectionName: 'U15', clubName: 'Kent PC', isReserve: false, ...over,
});

describe('telHref', () => {
  it('returns null for empty, blank or digit-free input', () => {
    expect(telHref(null)).toBeNull();
    expect(telHref(undefined)).toBeNull();
    expect(telHref('   ')).toBeNull();
    expect(telHref('+ - ()')).toBeNull();
  });
  it('keeps a leading plus and strips other punctuation', () => {
    expect(telHref(' +44 (0)7700 900-123 ')).toBe('tel:+4407700900123');
    expect(telHref('07700 900123')).toBe('tel:07700900123');
    expect(telHref('07700+900123')).toBe('tel:07700900123');
  });
});

describe('filterEmergencyContacts', () => {
  const entries = [
    contact(),
    contact({ riderEntryId: 2, riderName: 'Bob Green', ponyName: 'Biscuit', teamName: 'Surrey B', clubName: 'Surrey PC', bibColour: 'Red', bibDescription: 'Spotty', emergencyContactName: 'Jo Green', trainerName: 'Sam Trainer' }),
    contact({ riderEntryId: 3, riderName: 'Cy White', ponyName: null, bibColour: '', emergencyContactName: undefined, trainerName: null }),
  ];
  it('returns a copy of everything for a missing or blank query', () => {
    for (const q of [null, undefined, '', '   ']) {
      const out = filterEmergencyContacts(entries, q);
      expect(out).toEqual(entries);
      expect(out).not.toBe(entries);
    }
  });
  it('requires every token to match somewhere across the searchable fields, ignoring case', () => {
    expect(filterEmergencyContacts(entries, 'bob biscuit').map((e) => e.riderEntryId)).toEqual([2]);
    expect(filterEmergencyContacts(entries, 'SPOTTY red').map((e) => e.riderEntryId)).toEqual([2]);
    expect(filterEmergencyContacts(entries, 'jo green sam').map((e) => e.riderEntryId)).toEqual([2]);
    expect(filterEmergencyContacts(entries, 'kent u15').map((e) => e.riderEntryId)).toEqual([1, 3]);
    expect(filterEmergencyContacts(entries, 'kent surrey')).toEqual([]);
  });
  it('does not search phone numbers or medical notes', () => {
    const e = contact({ emergencyContactPhone: '07700900123', medicalNotes: 'asthma' });
    expect(filterEmergencyContacts([e], '07700')).toEqual([]);
    expect(filterEmergencyContacts([e], 'asthma')).toEqual([]);
  });
});

describe('steward attendance', () => {
  it('reads attendance case-insensitively and defaults to Assigned', () => {
    expect(isShiftCheckedInHere(shift())).toBe(false);
    expect(isShiftCheckedInHere(shift({ attendanceStatus: 'Here' }))).toBe(true);
    expect(isShiftCheckedInHere(shift({ attendanceStatus: 'here' as never }))).toBe(true);
    expect(isShiftMarkedMissing(shift())).toBe(false);
    expect(isShiftMarkedMissing(shift({ attendanceStatus: 'Missing' }))).toBe(true);
  });

  it('lists shifts not checked in, optionally for one session', () => {
    const shifts = [
      shift({ id: 1, sessionId: 1, attendanceStatus: 'Here' }),
      shift({ id: 2, sessionId: 1, attendanceStatus: 'Missing' }),
      shift({ id: 3, sessionId: 2 }),
      shift({ id: 4, sessionId: null }),
    ];
    expect(missingStewardShifts(shifts).map((s) => s.id)).toEqual([2, 3, 4]);
    expect(missingStewardShifts(shifts, null).map((s) => s.id)).toEqual([2, 3, 4]);
    expect(missingStewardShifts(shifts, 1).map((s) => s.id)).toEqual([2]);
    expect(missingStewardShifts(shifts, 7)).toEqual([]);
  });
});

describe('myTeamAssignedDuties', () => {
  const shifts = [
    shift({ id: 1, canViewerCheckIn: true }),
    shift({ id: 2, assignedTeamId: 5 }),
    shift({ id: 3, assignedTeamId: 6 }),
    shift({ id: 4, assignedClubName: '  Kent PC ' }),
    shift({ id: 5, assignedClubName: 'Other PC' }),
    shift({ id: 6, assignedClubName: null }),
    shift({ id: 7 }),
  ];
  it('matches by viewer permission, team id or club name', () => {
    expect(myTeamAssignedDuties(shifts, [5], 'kent pc').map((s) => s.id)).toEqual([1, 2, 4]);
  });
  it('without a club only team and permission matches count', () => {
    expect(myTeamAssignedDuties(shifts, [6]).map((s) => s.id)).toEqual([1, 3]);
    expect(myTeamAssignedDuties(shifts, [6], '   ').map((s) => s.id)).toEqual([1, 3]);
    expect(myTeamAssignedDuties(shifts, [], null).map((s) => s.id)).toEqual([1]);
  });
});

describe('sessionStewardDutySummary', () => {
  const shifts = [
    shift({ id: 1, sessionId: 1, attendanceStatus: 'Here' }),
    shift({ id: 2, sessionId: 1, attendanceStatus: 'Missing' }),
    shift({ id: 3, sessionId: 1 }),
    shift({ id: 4, sessionId: 2, attendanceStatus: 'Here' }),
  ];
  it('counts here, missing and waiting across all sessions when none is given', () => {
    expect(sessionStewardDutySummary(shifts)).toEqual({
      totalDuties: 4, hereCount: 2, missingCount: 1, assignedAwaitingCheckInCount: 1, allHere: false,
      readinessLabel: '2/4 here · 2 not checked in',
    });
  });
  it('can be limited to one session', () => {
    expect(sessionStewardDutySummary(shifts, 2)).toMatchObject({ totalDuties: 1, allHere: true, readinessLabel: 'All 1 stewards here' });
    expect(sessionStewardDutySummary(shifts, null).totalDuties).toBe(4);
  });
  it('says so when there are no duties', () => {
    expect(sessionStewardDutySummary([], 3)).toMatchObject({ totalDuties: 0, allHere: false, readinessLabel: 'No duties assigned' });
  });
});
