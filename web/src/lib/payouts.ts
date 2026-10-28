import type { MessageKey } from '../i18n/en/index.ts';
import { tr } from '../i18n/translate.ts';
import type { ClubPayouts, PayoutBusinessType, PayoutRegion, PayoutSchedule } from '../types';

/**
 * Checks and formatting for a club's payout details. The format rules mirror `api/Services/Payouts/PayoutRules.cs`,
 * so change both together. The server checks everything again; these only save a round trip.
 */

export const BULLETS = '••••';

export const BUSINESS_TYPES: PayoutBusinessType[] = [0, 1, 2, 3];
export const REGIONS: { value: PayoutRegion; currency: string }[] = [
  { value: 0, currency: 'GBP' },
  { value: 1, currency: 'EUR' },
];
export const SCHEDULES: PayoutSchedule[] = [0, 1, 2];

export const businessTypeLabel = (type: PayoutBusinessType) => tr(`acct.pay.type.${type}` as MessageKey);
export const businessTypeHint = (type: PayoutBusinessType) => tr(`acct.pay.type.${type}.hint` as MessageKey);
export const regionLabel = (region: PayoutRegion) => tr(`acct.pay.region.${region}` as MessageKey);
export const scheduleLabel = (schedule: PayoutSchedule) => tr(`acct.pay.schedule.${schedule}` as MessageKey);

export const needsRegistrationNumber = (type: number | null) => type === 2 || type === 3;
export const registrationLabel = (type: number | null) => (type === 2 ? tr('acct.pay.charityNumber') : tr('acct.pay.companyNumber'));

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

export const validateEmail = (v: string) => (v.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : tr('acct.pay.badEmail'));

export function validatePhone(v: string): string | null {
  const digits = (v.match(/\d/g) ?? []).length;
  return v.length <= 30 && /^\+?[0-9 ()-]+$/.test(v) && digits >= 7 && digits <= 15 ? null : tr('acct.pay.badPhone');
}

export function validatePostcode(v: string, region: PayoutRegion): string | null {
  if (region === 0) return /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/.test(v.trim().replace(/ +/g, ' ').toUpperCase()) ? null : tr('acct.pay.badPostcodeUk');
  return /^[A-Za-z0-9 -]{3,10}$/.test(v) ? null : tr('acct.pay.badPostcode');
}

export const validateRegistrationNumber = (v: string) => (/^[A-Za-z0-9]{5,12}$/.test(v.replace(/ /g, '')) ? null : tr('acct.pay.badRegNumber'));

export function validateVat(v: string, region: PayoutRegion): string | null {
  const t = v.replace(/ /g, '').toUpperCase();
  const ok = region === 0 ? /^(GB)?\d{9}(\d{3})?$/.test(t) : /^[A-Z]{2}[A-Z0-9]{7,12}$/.test(t);
  return ok ? null : tr('acct.pay.badVat');
}

export function validateDescriptor(v: string): string | null {
  return /^[A-Za-z0-9 ]{5,22}$/.test(v) && /[A-Za-z]/.test(v) ? null : tr('acct.pay.badDescriptor');
}

/** `dob` is YYYY-MM-DD; `today` is a Date (passed in so tests can fix it). */
export function validateDateOfBirth(dob: string, today: Date): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return tr('acct.pay.dobMissing');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return tr('acct.pay.dobNotReal');
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const eighteen = Date.UTC(today.getFullYear() - 18, today.getMonth(), today.getDate());
  const oldest = Date.UTC(today.getFullYear() - 120, today.getMonth(), today.getDate());
  if (date.getTime() > Math.min(t, eighteen)) return tr('acct.pay.dobTooYoung');
  return date.getTime() < oldest ? tr('acct.pay.dobCheck') : null;
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
  if (step === 1 && f.businessType == null) p.businessType = tr('acct.pay.pickType');
  if (step === 2) {
    required(p, 'legalName', f.legalName, tr('acct.pay.needLegalName'));
    required(p, 'addressLine1', f.addressLine1, tr('acct.pay.needAddress1'));
    required(p, 'city', f.city, tr('acct.pay.needCity'));
    required(p, 'postcode', f.postcode, tr('acct.pay.needPostcode'), (v) => validatePostcode(v, f.region));
    required(p, 'contactEmail', f.contactEmail, tr('acct.pay.needEmail'), validateEmail);
    required(p, 'contactPhone', f.contactPhone, tr('acct.pay.needPhone'), validatePhone);
    if (needsRegistrationNumber(f.businessType)) {
      required(p, 'registrationNumber', f.registrationNumber, tr(f.businessType === 2 ? 'acct.pay.enterCharity' : 'acct.pay.enterCompany'), validateRegistrationNumber);
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
    required(p, 'personFullName', f.personFullName, tr('acct.pay.needPerson'));
    const bad = validateDateOfBirth(f.personDateOfBirth, today);
    if (bad) p.personDateOfBirth = bad;
  }
  if (step === 5) required(p, 'statementDescriptor', f.statementDescriptor, tr('acct.pay.needDescriptor'), validateDescriptor);
  return p;
}

export interface BankForm { accountHolder: string; sortCode: string; accountNumber: string; iban: string; bic: string }
export const emptyBank: BankForm = { accountHolder: '', sortCode: '', accountNumber: '', iban: '', bic: '' };

/** Problems with the bank form for the club's region. Never includes the numbers themselves. */
export function bankProblems(f: BankForm, region: PayoutRegion): Problems {
  const p: Problems = {};
  if (!f.accountHolder.trim()) p.accountHolder = tr('acct.pay.needHolder');
  else if (f.accountHolder.trim().length > 150) p.accountHolder = tr('acct.pay.holderLong');
  if (region === 0) {
    if (!normaliseSortCode(f.sortCode)) p.sortCode = tr('acct.pay.badSortCode');
    if (!normaliseAccountNumber(f.accountNumber)) p.accountNumber = tr('acct.pay.badAccountNumber');
  } else {
    if (!normaliseIban(f.iban)) p.iban = tr('acct.pay.badIban');
    if (f.bic.trim() && !isValidBic(f.bic)) p.bic = tr('acct.pay.badBic');
  }
  return p;
}

/** What a club still has to add, in the words the Payouts page uses. Each group of keys is one thing. */
const MISSING_THINGS: { keys: string[]; noun: MessageKey }[] = [
  { keys: ['businessType'], noun: 'acct.pay.thing.type' },
  { keys: ['legalName', 'tradingName', 'addressLine1', 'addressLine2', 'city', 'postcode', 'contactEmail', 'contactPhone', 'registrationNumber', 'vatNumber'], noun: 'acct.pay.thing.legal' },
  { keys: ['personFullName', 'personDateOfBirth'], noun: 'acct.pay.thing.person' },
  { keys: ['bank', 'accountHolder', 'sortCode', 'accountNumber', 'iban', 'bic'], noun: 'acct.pay.thing.bank' },
  { keys: ['statementDescriptor', 'schedule'], noun: 'acct.pay.thing.statement' },
];

/**
 * The status line at the top of Payouts: "One thing left: add the club’s bank account." while something is missing,
 * and "Ready. Money from entries goes to account ending 1234." once it is finished.
 */
export function payoutStatusLine(p: Pick<ClubPayouts, 'status' | 'missing' | 'bank'>): { text: string; ready: boolean } {
  if (p.status === 2) {
    const last4 = (p.bank?.maskedAccount ?? '').replace(/\D/g, '').slice(-4);
    return { ready: true, text: tr('acct.pay.ready', { where: last4 ? tr('acct.pay.endingIn', { last4 }) : tr('acct.pay.clubAccount') }) };
  }
  const things = MISSING_THINGS.filter((thing) => thing.keys.some((key) => p.missing.includes(key))).map((thing) => tr(thing.noun));
  if (things.length === 0) return { ready: false, text: tr('acct.pay.nearly') };
  const list = things.length === 1 ? things[0] : tr('acct.pay.listAnd', { rest: things.slice(0, -1).join(', '), last: things[things.length - 1] });
  const word = things.length <= 5 ? tr(`acct.pay.word.${things.length}` as MessageKey) : String(things.length);
  return { ready: false, text: tr('acct.pay.left', { count: things.length, word, list }) };
}

/** The line the competition editor shows: "Entry fees are paid out to Ashdown PC: ••••1234 · Ready". */
export function payoutsLine(p: { clubName: string; maskedAccount: string | null; ready: boolean }): string {
  return p.ready && p.maskedAccount
    ? tr('admin.creator.payoutsReady', { club: p.clubName, account: p.maskedAccount })
    : tr('admin.creator.payoutsNotReady', { club: p.clubName });
}
