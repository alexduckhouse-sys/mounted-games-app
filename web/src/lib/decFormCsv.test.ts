import { describe, expect, it } from 'vitest';
import type { RiderEntry } from '../types';
import { NUMBER_FIELD, TEXT_FIELD, type CustomField } from './decFormConfig';
import { decFormsCsv } from './decFormCsv';

const rider = (over: Partial<RiderEntry> = {}): RiderEntry =>
  ({
    id: 1,
    fullName: 'Ava Jones',
    isReserve: false,
    isGuestRider: false,
    orderIndex: 0,
    horseName: null,
    ponyHeightHands: null,
    dateOfBirth: null,
    ...over,
  }) as unknown as RiderEntry;

const form = (over: Record<string, unknown> = {}) => ({
  teamName: 'Oak A',
  riders: [rider()],
  submittedAt: '2031-06-13T18:00:00Z',
  ...over,
});

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const parse = (csv: string) => csv.split('\r\n').map(splitLine);

describe('decFormsCsv', () => {
  it('writes only the base columns when nobody gave an extra answer', () => {
    const [header, row] = parse(decFormsCsv([form()], []));
    expect(header).toEqual([
      'Team', 'Rider', 'Reserve', 'Guest', 'DOB', 'Pony', 'Height (hh)', 'Bibs', 'Trainer', 'Phone',
      'Submitted by', 'Terms agreed', 'Submitted at', 'Notes',
    ]);
    expect(row.slice(0, 3)).toEqual(['Oak A', 'Ava Jones', '']);
    expect(row[4]).toBe('');
    expect(row[11]).toBe('');
    expect(row[12]).not.toBe('');
    expect(row).toHaveLength(14);
  });

  it('formats dob, height, flags, bibs, terms and falls back from trainer to submitter', () => {
    const csv = decFormsCsv(
      [
        form({
          bibDescription: '[flag:uk] Red',
          trainerName: null,
          submittedByName: 'Sam',
          trainerPhone: null,
          submittedByPhone: '0777',
          termsAcceptedAt: '2031-06-13T18:00:00Z',
          notes: 'Late, entry',
          riders: [
            rider({ id: 2, fullName: 'Second', orderIndex: 2, isReserve: true }),
            rider({ id: 3, fullName: 'First', orderIndex: 1, isGuestRider: true, dateOfBirth: '2015-04-09', horseName: 'Biscuit', ponyHeightHands: 13 }),
          ],
        }),
      ],
      [],
    );
    const rows = csv.split('\r\n');
    expect(rows).toHaveLength(3);
    const first = parse(rows[1])[0];
    expect(first.slice(0, 11)).toEqual(['Oak A', 'First', '', 'yes', '09/04/2015', 'Biscuit', '13.0', 'Red', 'Sam', '0777', 'Sam']);
    expect(first[11]).not.toBe('');
    expect(first[13]).toBe('Late, entry');
    expect(rows[2].startsWith('Oak A,Second,yes,')).toBe(true);
  });

  it('adds a column for each answer anyone gave, including custom fields and flags', () => {
    const fields: CustomField[] = [
      { id: 'c1', label: 'Shirt size', type: TEXT_FIELD, required: false },
      { id: 'c2', label: 'Unused', type: NUMBER_FIELD, required: false },
    ];
    const csv = decFormsCsv(
      [
        form({
          riders: [
            rider({
              id: 1,
              birthYear: 2012,
              ageGroup: 'U12',
              weightKg: 38,
              ponyPassportNumber: 'P1',
              ponyOwnerFullName: 'Owner',
              ponyAge: 9,
              membershipNumber: 'M1',
              emergencyContactName: 'Mum',
              emergencyContactPhone: '0123',
              medicalNotes: 'None',
              customValues: { c1: 'M' },
              flags: ['a', 'b'],
            } as never),
            rider({ id: 2, orderIndex: 1 }),
          ],
        }),
      ],
      fields,
    );
    const [header, r1, r2] = parse(csv);
    expect(header.slice(14)).toEqual([
      'Birth year', 'Age group', 'Weight (kg)', 'Pony passport or ID', 'Pony owner', 'Pony age',
      'Membership number', 'Emergency contact', 'Emergency phone', 'Medical notes', 'Shirt size', 'Flags',
    ]);
    expect(r1.slice(14)).toEqual(['2012', 'U12', '38', 'P1', 'Owner', '9', 'M1', 'Mum', '0123', 'None', 'M', 'a b']);
    expect(r2.slice(14)).toEqual(['', '', '', '', '', '', '', '', '', '', '', '']);
  });

  it('returns only the header for no forms', () => {
    expect(decFormsCsv([], []).split('\r\n')).toHaveLength(1);
  });
});
