import type { SignupGuestDetails, SignupGuestDetailsInput } from '../types';
import { blankRider, dobText, parseDob, type DecRider } from './decForm';
import { normalisePhone, PHONE_HELP } from './decFormConfig';

/**
 * The guest rider section of a guest or individual entry: the rider (when an adult enters for a child), their pony,
 * the parent or guardian and an emergency contact. Kept apart from the pages so the rules can be tested, and checked
 * the same way as the API (`SignupController.ParseGuestDetails`). These are a child's personal details: only the
 * competition's staff and the person who made the entry ever get them back.
 */

/** What the entry form holds, as typed. `riderDob` is `yyyy-mm-dd` (a date input) or `dd/mm/yyyy`. */
export interface GuestRiderFields {
  riderName: string;
  riderDob: string;
  ponyName: string;
  guardianName: string;
  guardianPhone: string;
  emergencyName: string;
  emergencyPhone: string;
}

export const blankGuestRider = (): GuestRiderFields => ({
  riderName: '', riderDob: '', ponyName: '', guardianName: '', guardianPhone: '', emergencyName: '', emergencyPhone: '',
});

/** Matches the API's `SignupGuestDetails.MaxNameLength`. */
export const MAX_GUEST_NAME = 120;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `yyyy-mm-dd` for a typed date of birth (either form), or null when it isn't a real date in the past. */
export function guestDobIso(text: string, today: Date = new Date()): string | null {
  const value = text.trim();
  const iso = ISO_DAY.exec(value);
  return parseDob(iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value, today);
}

/** What's wrong with the guest section, or null when it can be sent. Everything in it is optional. */
export function guestRiderProblem(fields: GuestRiderFields, today: Date = new Date()): string | null {
  const names = [fields.riderName, fields.ponyName, fields.guardianName, fields.emergencyName];
  if (names.some((n) => n.trim().length > MAX_GUEST_NAME)) return `Names must be ${MAX_GUEST_NAME} characters or fewer.`;
  if (fields.riderDob.trim() && guestDobIso(fields.riderDob, today) === null) {
    return 'Enter the rider’s date of birth as a real date in the past, like 05/04/2015.';
  }
  if (!fields.guardianName.trim() !== !fields.guardianPhone.trim()) return 'Give both the parent or guardian’s name and phone number, or neither.';
  if (!fields.emergencyName.trim() !== !fields.emergencyPhone.trim()) return 'Give both the emergency contact’s name and phone number, or neither.';
  if (fields.guardianPhone.trim() && normalisePhone(fields.guardianPhone) === null) return `Parent or guardian’s phone: ${PHONE_HELP}`;
  if (fields.emergencyPhone.trim() && normalisePhone(fields.emergencyPhone) === null) return `Emergency contact’s phone: ${PHONE_HELP}`;
  return null;
}

/**
 * The guest fields for the sign-up request: trimmed, blanks left out, the date as `yyyy-mm-dd`. An empty object when
 * nothing was typed, so an adult entering themselves sends nothing extra.
 */
export function guestRiderBody(fields: GuestRiderFields, today: Date = new Date()): SignupGuestDetailsInput {
  const body: SignupGuestDetailsInput = {};
  const put = (key: keyof SignupGuestDetailsInput, value: string | null) => { if (value) body[key] = value; };
  put('riderName', fields.riderName.trim());
  put('riderDateOfBirth', fields.riderDob.trim() ? guestDobIso(fields.riderDob, today) ?? fields.riderDob.trim() : null);
  put('ponyName', fields.ponyName.trim());
  put('guardianName', fields.guardianName.trim());
  put('guardianPhone', fields.guardianPhone.trim());
  put('emergencyContactName', fields.emergencyName.trim());
  put('emergencyContactPhone', fields.emergencyPhone.trim());
  return body;
}

/** Whole years old on `on`, from a `yyyy-mm-dd` date of birth; null without a usable date. */
export function ageOn(dobIso: string | null | undefined, on: Date): number | null {
  const match = ISO_DAY.exec((dobIso ?? '').slice(0, 10));
  if (!match || Number.isNaN(on.getTime())) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = on.getFullYear() - year;
  if (on.getMonth() + 1 < month || (on.getMonth() + 1 === month && on.getDate() < day)) age--;
  return age >= 0 ? age : null;
}

/** The ages an age group's name allows ("U12", "Under 14s", "12 & under", "16+", "10-12"); null when it doesn't say. */
export function ageLimitsOf(ageGroup: string | null | undefined): { min: number | null; max: number | null } | null {
  const text = (ageGroup ?? '').trim();
  let m = /\b(\d{1,2})\s*(?:&|and)\s*under\b/i.exec(text);
  if (m) return { min: null, max: Number(m[1]) };
  m = /\bu(?:nder)?\s*-?\s*(\d{1,2})s?\b/i.exec(text);
  if (m) return { min: null, max: Number(m[1]) - 1 };
  m = /\b(\d{1,2})\s*(?:\+|(?:&|and)\s*over\b)/i.exec(text);
  if (m) return { min: Number(m[1]), max: null };
  m = /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b/i.exec(text);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  return null;
}

/**
 * A gentle warning when a guest rider's date of birth doesn't fit the age group, for the entry form and the staff
 * entries list. Age is taken on 1 January of the competition's year, as Pony Club and MGA age groups are. Null when it
 * fits, or when either the date or the age group's name doesn't say enough to tell.
 */
export function ageGroupWarning(dobIso: string | null | undefined, ageGroup: string | null | undefined, competitionStart: string | Date): string | null {
  const limits = ageLimitsOf(ageGroup);
  const start = new Date(competitionStart);
  if (!limits || Number.isNaN(start.getTime())) return null;
  const age = ageOn(dobIso, new Date(start.getFullYear(), 0, 1));
  if (age == null) return null;
  if (limits.max != null && age > limits.max) return `This rider is ${age} on 1 January, older than ${ageGroup?.trim()} allows.`;
  if (limits.min != null && age < limits.min) return `This rider is ${age} on 1 January, younger than ${ageGroup?.trim()} allows.`;
  return null;
}

/**
 * The entry's rider as a dec form rider, to pre-fill the first slot of a team formed from a guest entry. Null when the
 * entry named no rider, so the form starts blank as before.
 */
export function decRiderFromGuest(guest: SignupGuestDetails | null | undefined): DecRider | null {
  const name = guest?.riderName?.trim();
  if (!name) return null;
  return { ...blankRider(), fullName: name, dob: dobText(guest?.riderDateOfBirth), pony: guest?.ponyName?.trim() ?? '', isGuestRider: true };
}

/** One line for the staff entries list: "Rider · born 05/04/2015 · Pony". Empty when the entry named no rider. */
export function guestRiderSummary(guest: SignupGuestDetails | null | undefined): string {
  if (!guest?.riderName?.trim()) return '';
  const born = dobText(guest.riderDateOfBirth);
  return [guest.riderName.trim(), born ? `born ${born}` : '', guest.ponyName?.trim() ?? ''].filter(Boolean).join(' · ');
}

/** "Name · phone" lines for the parent and the emergency contact, for staff only. */
export function guestContactLines(guest: SignupGuestDetails | null | undefined): string[] {
  if (!guest) return [];
  const line = (label: string, name: string | null, phone: string | null) =>
    name?.trim() ? `${label}: ${[name.trim(), phone?.trim()].filter(Boolean).join(' · ')}` : '';
  return [
    line('Parent or guardian', guest.guardianName, guest.guardianPhone),
    line('Emergency contact', guest.emergencyContactName, guest.emergencyContactPhone),
  ].filter(Boolean);
}
