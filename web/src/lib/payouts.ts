import type { ClubPayouts, PayoutBusinessType, PayoutRegion, PayoutSchedule } from '../types';

/**
 * Checks and formatting for a club's payout details. The format rules mirror `api/Services/Payouts/PayoutRules.cs`,
 * so change both together. The server checks everything again; these only save a round trip.
 */

export const BULLETS = '••••';

export const BUSINESS_TYPES: { value: PayoutBusinessType; label: string; hint: string }[] = [
  { value: 0, label: 'Individual or sole trader', hint: 'One person, in their own name' },
  { value: 1, label: 'Club or association', hint: 'A pony club or similar group' },
  { value: 2, label: 'Registered charity', hint: 'Has a charity number' },
  { value: 3, label: 'Company', hint: 'Has a company number' },
];

export const REGIONS: { value: PayoutRegion; label: string; currency: string }[] = [
  { value: 0, label: 'United Kingdom', currency: 'GBP' },
  { value: 1, label: 'Ireland or the EU', currency: 'EUR' },
];

export const SCHEDULES: { value: PayoutSchedule; label: string; hint: string }[] = [
  { value: 0, label: 'Daily', hint: 'Every working day' },
  { value: 1, label: 'Weekly', hint: 'Once a week' },
  { value: 2, label: 'After each event', hint: 'When an event finishes' },
];

export const STEPS = [
  "Who's being paid", 'Business details', 'Responsible person', 'Bank account', 'Statement and schedule', 'Review and finish',
] as const;

export const businessTypeLabel = (value: number | null | undefined) => BUSINESS_TYPES.find((t) => t.value === value)?.label ?? '';
export const regionLabel = (value: number) => REGIONS.find((r) => r.value === value)?.label ?? '';
export const scheduleLabel = (value: number) => SCHEDULES.find((s) => s.value === value)?.label ?? '';
export const needsRegistrationNumber = (type: number | null) => type === 2 || type === 3;
export const registrationLabel = (type: number | null) => (type === 2 ? 'Charity number' : 'Company number');

/** Keeps digits only, up to `max`. Used for number boxes so nothing like "e" or "-" gets in. */
export function digitsOnly(raw: string, max: number): string {
  return raw.replace(/\D/g, '').slice(0, max);
}

/** A sort code as it is typed or shown: 12-34-56. */
export function formatSortCode(raw: string): string {
  const d = digitsOnly(raw, 6);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 6)].filter(Boolean).join('-');
}

export function normaliseSortCode(raw: string): string | null {
  const d = raw.replace(/[ -]/g, '');
  return /^\d{6}$/.test(d) ? d : null;
}

export function normaliseAccountNumber(raw: string): string | null {
  const d = raw.replace(/[ -]/g, '');
  return /^\d{8}$/.test(d) ? d : null;
}

const IBAN_LENGTHS: Record<string, number> = {
  IE: 22, GB: 22, FR: 27, DE: 22, ES: 24, IT: 27, NL: 18, BE: 16, PT: 25, AT: 20, LU: 20, FI: 18,
};

/** An IBAN as it is typed or shown: capitals in groups of four. */
export function formatIban(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 34);
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

/** The IBAN without spaces when its shape and mod-97 check pass, otherwise null. */
export function normaliseIban(raw: string): string | null {
  const iban = raw.replace(/ /g, '').toUpperCase();
  if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return null;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return null;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1 ? iban : null;
}

export const isValidBic = (raw: string) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(raw.replace(/ /g, '').toUpperCase());

export const maskedAccount = (last4: string | null | undefined) => (last4 ? BULLETS + last4 : '');

/** "Barclays ••••1234", or just the masked number when the bank isn't known. */
export function bankLine(bank: ClubPayouts['bank']): string {
  if (!bank) return '';
  return [bank.bankName, bank.maskedAccount].filter(Boolean).join(' ');
}

export type Problems = Record<string, string>;

export const validateEmail = (v: string) => (v.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Enter a valid email address.');

export function validatePhone(v: string): string | null {
  const digits = (v.match(/\d/g) ?? []).length;
  return v.length <= 30 && /^\+?[0-9 ()-]+$/.test(v) && digits >= 7 && digits <= 15 ? null : 'Enter a valid phone number.';
}

export function validatePostcode(v: string, region: PayoutRegion): string | null {
  if (region === 0) return /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/.test(v.trim().replace(/ +/g, ' ').toUpperCase()) ? null : 'Enter a UK postcode, like SW1A 1AA.';
  return /^[A-Za-z0-9 -]{3,10}$/.test(v) ? null : 'Enter a valid postcode.';
}

export const validateRegistrationNumber = (v: string) => (/^[A-Za-z0-9]{5,12}$/.test(v.replace(/ /g, '')) ? null : 'Use 5 to 12 letters or numbers.');

export function validateVat(v: string, region: PayoutRegion): string | null {
  const t = v.replace(/ /g, '').toUpperCase();
  const ok = region === 0 ? /^(GB)?\d{9}(\d{3})?$/.test(t) : /^[A-Z]{2}[A-Z0-9]{7,12}$/.test(t);
  return ok ? null : 'Enter a valid VAT number, like GB123456789.';
}

export function validateDescriptor(v: string): string | null {
  return /^[A-Za-z0-9 ]{5,22}$/.test(v) && /[A-Za-z]/.test(v) ? null : 'Use 5 to 22 letters, numbers or spaces, with at least one letter.';
}

/** `dob` is YYYY-MM-DD; `today` is a Date (passed in so tests can fix it). */
export function validateDateOfBirth(dob: string, today: Date): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return 'Enter their date of birth.';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return 'Enter a real date.';
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const eighteen = Date.UTC(today.getFullYear() - 18, today.getMonth(), today.getDate());
  const oldest = Date.UTC(today.getFullYear() - 120, today.getMonth(), today.getDate());
  if (date.getTime() > Math.min(t, eighteen)) return 'They must be at least 18.';
  return date.getTime() < oldest ? 'Check the date of birth.' : null;
}

/** The text fields of the details steps, as the page holds them while editing. */
export interface PayoutForm {
  businessType: PayoutBusinessType | null;
  region: PayoutRegion;
  legalName: string; tradingName: string;
  addressLine1: string; addressLine2: string; city: string; postcode: string;
  contactEmail: string; contactPhone: string; registrationNumber: string; vatNumber: string;
  personFullName: string; personDateOfBirth: string;
  statementDescriptor: string; schedule: PayoutSchedule;
}

export function formFrom(p: ClubPayouts): PayoutForm {
  return {
    businessType: p.businessType, region: p.region,
    legalName: p.legalName ?? '', tradingName: p.tradingName ?? '',
    addressLine1: p.addressLine1 ?? '', addressLine2: p.addressLine2 ?? '', city: p.city ?? '', postcode: p.postcode ?? '',
    contactEmail: p.contactEmail ?? '', contactPhone: p.contactPhone ?? '',
    registrationNumber: p.registrationNumber ?? '', vatNumber: p.vatNumber ?? '',
    personFullName: p.personFullName ?? '', personDateOfBirth: p.personDateOfBirth ?? '',
    statementDescriptor: p.statementDescriptor ?? '', schedule: p.schedule,
  };
}

const required = (p: Problems, key: string, value: string, message: string, check?: (v: string) => string | null) => {
  const v = value.trim();
  if (!v) p[key] = message;
  else { const bad = check?.(v); if (bad) p[key] = bad; }
};

/** Problems with one of the details steps (1, 2, 3 or 5), keyed by the same names the API uses. */
export function stepProblems(step: 1 | 2 | 3 | 5, f: PayoutForm, today: Date): Problems {
  const p: Problems = {};
  if (step === 1 && f.businessType == null) p.businessType = 'Pick who is being paid.';
  if (step === 2) {
    required(p, 'legalName', f.legalName, 'Enter the legal name.');
    required(p, 'addressLine1', f.addressLine1, 'Enter the first line of the address.');
    required(p, 'city', f.city, 'Enter the town or city.');
    required(p, 'postcode', f.postcode, 'Enter the postcode.', (v) => validatePostcode(v, f.region));
    required(p, 'contactEmail', f.contactEmail, 'Enter a contact email.', validateEmail);
    required(p, 'contactPhone', f.contactPhone, 'Enter a contact phone number.', validatePhone);
    if (needsRegistrationNumber(f.businessType)) {
      required(p, 'registrationNumber', f.registrationNumber, `Enter the ${registrationLabel(f.businessType).toLowerCase()}.`, validateRegistrationNumber);
    } else if (f.registrationNumber.trim()) {
      const bad = validateRegistrationNumber(f.registrationNumber.trim());
      if (bad) p.registrationNumber = bad;
    }
    if (f.vatNumber.trim()) {
      const bad = validateVat(f.vatNumber.trim(), f.region);
      if (bad) p.vatNumber = bad;
    }
  }
  if (step === 3) {
    required(p, 'personFullName', f.personFullName, "Enter the responsible person's full name.");
    const bad = validateDateOfBirth(f.personDateOfBirth, today);
    if (bad) p.personDateOfBirth = bad;
  }
  if (step === 5) required(p, 'statementDescriptor', f.statementDescriptor, 'Enter a statement descriptor.', validateDescriptor);
  return p;
}

export interface BankForm { accountHolder: string; sortCode: string; accountNumber: string; iban: string; bic: string }
export const emptyBank: BankForm = { accountHolder: '', sortCode: '', accountNumber: '', iban: '', bic: '' };

/** Problems with the bank form for the club's region. Never includes the numbers themselves. */
export function bankProblems(f: BankForm, region: PayoutRegion): Problems {
  const p: Problems = {};
  if (!f.accountHolder.trim()) p.accountHolder = 'Enter the name on the account.';
  else if (f.accountHolder.trim().length > 150) p.accountHolder = 'Use 150 characters or fewer.';
  if (region === 0) {
    if (!normaliseSortCode(f.sortCode)) p.sortCode = 'A sort code has 6 digits.';
    if (!normaliseAccountNumber(f.accountNumber)) p.accountNumber = 'An account number has 8 digits.';
  } else {
    if (!normaliseIban(f.iban)) p.iban = "That IBAN doesn't look right. Check it and try again.";
    if (f.bic.trim() && !isValidBic(f.bic)) p.bic = 'A BIC has 8 or 11 letters and numbers.';
  }
  return p;
}

/** Which step holds a field the API reported, so the page can take the person back to it. */
export function stepOfField(key: string): number {
  if (key === 'businessType' || key === 'region') return 1;
  if (key === 'personFullName' || key === 'personDateOfBirth') return 3;
  if (key === 'bank' || key === 'accountHolder' || key === 'sortCode' || key === 'accountNumber' || key === 'iban' || key === 'bic') return 4;
  if (key === 'statementDescriptor' || key === 'schedule') return 5;
  return 2;
}

/** The step to open on: the review when the account is ready, else the first step with something missing. */
export function firstOpenStep(p: ClubPayouts): number {
  if (p.status === 2) return 6;
  if (p.status === 0) return 1;
  const steps = p.missing.map(stepOfField);
  return steps.length ? Math.min(...steps) : 6;
}

/** Turns "2004-02-30" style text into a friendly date for the review, e.g. "14 March 1985". */
export function friendlyDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return '';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The line the competition editor shows: "Entry fees are paid out to Ashdown PC: ••••1234 · Ready". */
export function payoutsLine(p: { clubName: string; maskedAccount: string | null; ready: boolean }): string {
  return p.ready && p.maskedAccount
    ? `Entry fees are paid out to ${p.clubName} — ${p.maskedAccount} · Ready`
    : `${p.clubName} hasn't finished setting up payouts yet.`;
}
