import type { RiderEntry } from '../types';
import type { CustomField } from './decFormConfig';
import { parseBibAndFlag } from './bib';
import { toCsv } from './csv';
import { dobText, heightText } from './decForm';

/** Every submitted dec form as CSV, one row per rider, with a column for each answer anyone gave. */
export function decFormsCsv(forms: ReadonlyArray<{ teamName: string; riders: RiderEntry[]; bibDescription?: string | null; trainerName?: string | null; submittedByName?: string | null; trainerPhone?: string | null; submittedByPhone?: string | null; termsAcceptedAt?: string | null; submittedAt: string; notes?: string | null }>, customFields: readonly CustomField[]): string {
  const header = ['Team', 'Rider', 'Reserve', 'Guest', 'DOB', 'Pony', 'Height (hh)', 'Bibs', 'Trainer', 'Phone', 'Submitted by', 'Terms agreed', 'Submitted at', 'Notes'];
  // The answers an organiser added are only in the file when someone gave one (the API only sends them to staff and the submitter).
  const allRiders = forms.flatMap((f) => f.riders);
      const everyColumn: { title: string; value: (r: RiderEntry) => string }[] = [
    { title: 'Birth year', value: (r) => (r.birthYear == null ? '' : String(r.birthYear)) },
    { title: 'Age group', value: (r) => r.ageGroup ?? '' },
    { title: 'Weight (kg)', value: (r) => (r.weightKg == null ? '' : String(r.weightKg)) },
    { title: 'Pony passport or ID', value: (r) => r.ponyPassportNumber ?? '' },
    { title: 'Pony owner', value: (r) => r.ponyOwnerFullName ?? '' },
    { title: 'Pony age', value: (r) => (r.ponyAge == null ? '' : String(r.ponyAge)) },
    { title: 'Membership number', value: (r) => r.membershipNumber ?? '' },
    { title: 'Emergency contact', value: (r) => r.emergencyContactName ?? '' },
    { title: 'Emergency phone', value: (r) => r.emergencyContactPhone ?? '' },
    { title: 'Medical notes', value: (r) => r.medicalNotes ?? '' },
    ...customFields.map((c) => ({ title: c.label, value: (r: RiderEntry) => r.customValues?.[c.id] ?? '' })),
    { title: 'Flags', value: (r) => (r.flags ?? []).join(' ') },
  ];
  const extraColumns = everyColumn.filter((c) => allRiders.some((r) => c.value(r) !== ''));
  const rows: ReadonlyArray<string>[] = [];
  for (const f of forms) {
    const riders = f.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex);
    for (const r of riders) {
      rows.push([
        f.teamName,
        r.fullName,
        r.isReserve ? 'yes' : '',
        r.isGuestRider ? 'yes' : '',
        dobText(r.dateOfBirth),
        r.horseName ?? '',
        heightText(r.ponyHeightHands),
        parseBibAndFlag(f.bibDescription).bib,
        f.trainerName ?? f.submittedByName ?? '',
        f.trainerPhone ?? f.submittedByPhone ?? '',
        f.submittedByName ?? '',
        f.termsAcceptedAt ? new Date(f.termsAcceptedAt).toLocaleString() : '',
        new Date(f.submittedAt).toLocaleString(),
        f.notes ?? '',
        ...extraColumns.map((c) => c.value(r)),
      ]);
    }
  }
  return toCsv([...header, ...extraColumns.map((c) => c.title)], rows);
}
