import { describe, expect, it } from 'vitest';
import {
  ageGroupWarning, ageLimitsOf, ageOn, blankGuestRider, decRiderFromGuest, guestContactLines, guestDobIso, guestRiderBody, guestRiderProblem,
  guestRiderSummary, MAX_GUEST_NAME, type GuestRiderFields,
} from './guestRider';
import type { SignupGuestDetails } from '../types';

const today = new Date(2026, 9, 26);
const filled = (patch: Partial<GuestRiderFields> = {}): GuestRiderFields => ({
  riderName: ' Fakerider Testchild ', riderDob: '2015-04-05', ponyName: 'Synthetic Ponyname',
  guardianName: 'Fakeparent Testadult', guardianPhone: '07700 900123', emergencyName: 'Fakeaunt Testcontact', emergencyPhone: '07700 900456',
  ...patch,
});
const saved: SignupGuestDetails = {
  riderName: 'Fakerider Testchild', riderDateOfBirth: '2015-04-05', ponyName: 'Synthetic Ponyname',
  guardianName: 'Fakeparent Testadult', guardianPhone: '07700900123', emergencyContactName: 'Fakeaunt Testcontact', emergencyContactPhone: '07700900456',
};

describe('guestDobIso', () => {
  it('reads a date input or dd/mm/yyyy, and refuses the future and nonsense', () => {
    expect(guestDobIso('2015-04-05', today)).toBe('2015-04-05');
    expect(guestDobIso(' 05/04/2015 ', today)).toBe('2015-04-05');
    expect(guestDobIso('2099-01-01', today)).toBeNull();
    expect(guestDobIso('2015-02-30', today)).toBeNull();
    expect(guestDobIso('soon', today)).toBeNull();
  });
});

describe('guestRiderProblem', () => {
  it('lets everything be blank, or everything be filled', () => {
    expect(guestRiderProblem(blankGuestRider(), today)).toBeNull();
    expect(guestRiderProblem(filled(), today)).toBeNull();
  });

  it('matches the API’s checks', () => {
    expect(guestRiderProblem(filled({ riderName: 'x'.repeat(MAX_GUEST_NAME + 1) }), today)).toMatch(/120 characters/);
    expect(guestRiderProblem(filled({ riderDob: '2099-01-01' }), today)).toMatch(/date of birth/);
    expect(guestRiderProblem(filled({ guardianPhone: '' }), today)).toMatch(/parent or guardian’s name and phone/);
    expect(guestRiderProblem(filled({ emergencyName: '' }), today)).toMatch(/emergency contact’s name and phone/);
    expect(guestRiderProblem(filled({ guardianPhone: '12345' }), today)).toMatch(/^Parent or guardian’s phone/);
    expect(guestRiderProblem(filled({ emergencyPhone: 'call me' }), today)).toMatch(/^Emergency contact’s phone/);
  });
});

describe('guestRiderBody', () => {
  it('sends trimmed values with the date as yyyy-mm-dd', () => {
    expect(guestRiderBody(filled({ riderDob: '05/04/2015' }), today)).toEqual({
      riderName: 'Fakerider Testchild', riderDateOfBirth: '2015-04-05', ponyName: 'Synthetic Ponyname',
      guardianName: 'Fakeparent Testadult', guardianPhone: '07700 900123', emergencyContactName: 'Fakeaunt Testcontact', emergencyContactPhone: '07700 900456',
    });
  });

  it('sends nothing for an empty section, and a bad date as typed so the API can explain', () => {
    expect(guestRiderBody(blankGuestRider(), today)).toEqual({});
    expect(guestRiderBody({ ...blankGuestRider(), riderDob: ' someday ' }, today)).toEqual({ riderDateOfBirth: 'someday' });
  });

  it('defaults to today', () => {
    expect(guestRiderBody({ ...blankGuestRider(), riderDob: '2015-04-05' })).toEqual({ riderDateOfBirth: '2015-04-05' });
    expect(guestRiderProblem(blankGuestRider())).toBeNull();
    expect(guestDobIso('2015-04-05')).toBe('2015-04-05');
  });
});

describe('ages and age groups', () => {
  it('counts whole years', () => {
    expect(ageOn('2015-04-05', new Date(2026, 3, 4))).toBe(10);
    expect(ageOn('2015-04-05', new Date(2026, 3, 5))).toBe(11);
    expect(ageOn('2015-04-05T00:00:00', new Date(2026, 2, 30))).toBe(10);
    expect(ageOn('2015-04-05', new Date(2026, 4, 1))).toBe(11);
    expect(ageOn(null, today)).toBeNull();
    expect(ageOn('2015-04-05', new Date('nope'))).toBeNull();
    expect(ageOn('2030-01-01', today)).toBeNull();
  });

  it('reads the common age group names', () => {
    expect(ageLimitsOf('U12')).toEqual({ min: null, max: 11 });
    expect(ageLimitsOf('Under 14s')).toEqual({ min: null, max: 13 });
    expect(ageLimitsOf('12 & under')).toEqual({ min: null, max: 12 });
    expect(ageLimitsOf('16+')).toEqual({ min: 16, max: null });
    expect(ageLimitsOf('18 and over')).toEqual({ min: 18, max: null });
    expect(ageLimitsOf('10-12')).toEqual({ min: 10, max: 12 });
    expect(ageLimitsOf('Open')).toBeNull();
    expect(ageLimitsOf(null)).toBeNull();
  });

  it('warns when the saved date of birth doesn’t fit, using 1 January of the event’s year', () => {
    // Born April 2015: 10 on 1 January 2026, though 11 by the summer show.
    expect(ageGroupWarning('2015-04-05', 'U11', '2026-07-01T09:00:00Z')).toBeNull();
    expect(ageGroupWarning('2015-04-05', 'U10', '2026-07-01T09:00:00Z')).toBe('This rider is 10 on 1 January, older than U10 allows.');
    expect(ageGroupWarning('2015-04-05', '12 & over', '2026-07-01T09:00:00Z')).toBe('This rider is 10 on 1 January, younger than 12 & over allows.');
    expect(ageGroupWarning('2015-04-05', 'Open', '2026-07-01')).toBeNull();
    expect(ageGroupWarning(null, 'U12', '2026-07-01')).toBeNull();
    expect(ageGroupWarning('2015-04-05', 'U12', 'not a date')).toBeNull();
    expect(ageGroupWarning('2015-04-05', 'U10', new Date(2026, 6, 1))).toMatch(/older/);
  });
});

describe('carrying the rider on', () => {
  it('pre-fills a dec form rider from the entry', () => {
    expect(decRiderFromGuest(saved)).toMatchObject({ fullName: 'Fakerider Testchild', dob: '05/04/2015', pony: 'Synthetic Ponyname', isGuestRider: true });
    expect(decRiderFromGuest({ ...saved, riderDateOfBirth: null, ponyName: null })).toMatchObject({ dob: '', pony: '' });
    expect(decRiderFromGuest({ ...saved, riderName: '  ' })).toBeNull();
    expect(decRiderFromGuest(null)).toBeNull();
  });

  it('summarises the rider and contacts for staff', () => {
    expect(guestRiderSummary(saved)).toBe('Fakerider Testchild · born 05/04/2015 · Synthetic Ponyname');
    expect(guestRiderSummary({ ...saved, riderDateOfBirth: null, ponyName: null })).toBe('Fakerider Testchild');
    expect(guestRiderSummary(undefined)).toBe('');
    expect(guestContactLines(saved)).toEqual([
      'Parent or guardian: Fakeparent Testadult · 07700900123',
      'Emergency contact: Fakeaunt Testcontact · 07700900456',
    ]);
    expect(guestContactLines({ ...saved, guardianName: null, emergencyContactPhone: null })).toEqual(['Emergency contact: Fakeaunt Testcontact']);
    expect(guestContactLines(null)).toEqual([]);
  });
});
