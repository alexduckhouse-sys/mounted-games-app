import { describe, expect, it } from 'vitest';
import type { ClubPayouts } from '../types';
import {
  bankLine, bankProblems, digitsOnly, emptyBank, formFrom, formatIban, formatSortCode,
  isSafeStripeUrl, isValidBic, maskedAccount, needsRegistrationNumber, normaliseAccountNumber, normaliseIban, normaliseSortCode, payoutStatusLine, payoutsLine,
  registrationLabel, stepProblems, stripeStatusInfo, validateDateOfBirth, validateDescriptor, validateEmail, validatePhone,
  validatePostcode, validateRegistrationNumber, validateVat, BULLETS,
} from './payouts';

const today = new Date(2026, 9, 23);

const saved = (extra: Partial<ClubPayouts> = {}): ClubPayouts => ({
  clubId: 1, clubName: 'Ashdown PC', status: 1, businessType: 1, region: 0, currency: 'GBP',
  legalName: 'Ashdown Pony Club', tradingName: null, addressLine1: '1 High Street', addressLine2: null, city: 'Reading', postcode: 'RG1 1AB',
  contactEmail: 'a@example.org', contactPhone: '+44 7700 900123', registrationNumber: null, vatNumber: null,
  personFullName: 'Ann Smith', personDateOfBirth: '1985-03-14', statementDescriptor: 'ASHDOWN PC', schedule: 1,
  bank: null, missing: [], updatedAt: null, ...extra,
});

describe('number and bank formatting', () => {
  it('keeps digits only, up to a limit', () => {
    expect(digitsOnly('12e-3 4x', 8)).toBe('1234');
    expect(digitsOnly('123456789', 8)).toBe('12345678');
  });
  it('shows a sort code as 12-34-56 while typing', () => {
    expect(formatSortCode('1')).toBe('1');
    expect(formatSortCode('123')).toBe('12-3');
    expect(formatSortCode('12-34-5678')).toBe('12-34-56');
    expect(formatSortCode('')).toBe('');
  });
  it('accepts a six-digit sort code and an eight-digit account number only', () => {
    expect(normaliseSortCode('12-34-56')).toBe('123456');
    expect(normaliseSortCode('12-34-5')).toBeNull();
    expect(normaliseAccountNumber('1234 5678')).toBe('12345678');
    expect(normaliseAccountNumber('1234567')).toBeNull();
  });
  it('checks an IBAN by shape, country length and mod 97', () => {
    expect(normaliseIban('ie29 aibk 9311 5212 3456 78')).toBe('IE29AIBK93115212345678');
    expect(normaliseIban('GB82WEST12345698765432')).not.toBeNull();
    expect(normaliseIban('IE29AIBK93115212345679')).toBeNull();
    expect(normaliseIban('IE29AIBK9311521234567')).toBeNull();
    expect(normaliseIban('12')).toBeNull();
    expect(normaliseIban('1234567890123456')).toBeNull();
    expect(normaliseIban('XX82WEST12345698765432')).toBeNull();
  });
  it('groups an IBAN in fours as it is typed', () => {
    expect(formatIban('ie29aibk93115212345678')).toBe('IE29 AIBK 9311 5212 3456 78');
    expect(formatIban('ie29 *')).toBe('IE29');
  });
  it('checks a BIC and masks an account', () => {
    expect(isValidBic('aibkie2d')).toBe(true);
    expect(isValidBic('AIBKIE2DXXX')).toBe(true);
    expect(isValidBic('nope')).toBe(false);
    expect(maskedAccount('1234')).toBe(`${BULLETS}1234`);
    expect(maskedAccount(null)).toBe('');
    expect(bankLine(null)).toBe('');
    expect(bankLine({ accountHolder: 'x', bankName: 'Barclays', sortCode: '20-12-34', maskedAccount: `${BULLETS}1234`, ibanCountry: null })).toBe(`Barclays ${BULLETS}1234`);
    expect(bankLine({ accountHolder: 'x', bankName: null, sortCode: null, maskedAccount: `${BULLETS}5678`, ibanCountry: 'IE' })).toBe(`${BULLETS}5678`);
  });
});

describe('field checks', () => {
  it('checks email and phone', () => {
    expect(validateEmail('a@b.co')).toBeNull();
    expect(validateEmail('nope')).not.toBeNull();
    expect(validatePhone('+44 7700 900123')).toBeNull();
    expect(validatePhone('abc')).not.toBeNull();
    expect(validatePhone('123')).not.toBeNull();
  });
  it('checks postcodes by region', () => {
    expect(validatePostcode('rg1  1ab', 0)).toBeNull();
    expect(validatePostcode('12345', 0)).not.toBeNull();
    expect(validatePostcode('D02 X285', 1)).toBeNull();
    expect(validatePostcode('!!', 1)).not.toBeNull();
  });
  it('checks registration, VAT and descriptor', () => {
    expect(validateRegistrationNumber('1234567')).toBeNull();
    expect(validateRegistrationNumber('12')).not.toBeNull();
    expect(validateVat('GB123456789', 0)).toBeNull();
    expect(validateVat('123456789', 0)).toBeNull();
    expect(validateVat('xyz', 0)).not.toBeNull();
    expect(validateVat('IE1234567A', 1)).toBeNull();
    expect(validateVat('12', 1)).not.toBeNull();
    expect(validateDescriptor('ASHDOWN PC')).toBeNull();
    expect(validateDescriptor('ABC')).not.toBeNull();
    expect(validateDescriptor('12345 678')).not.toBeNull();
    expect(validateDescriptor('Bad*Name here')).not.toBeNull();
  });
  it('checks a date of birth', () => {
    expect(validateDateOfBirth('1985-03-14', today)).toBeNull();
    expect(validateDateOfBirth('', today)).toBe('Enter their date of birth.');
    expect(validateDateOfBirth('2002-02-30', today)).toBe('Enter a real date.');
    expect(validateDateOfBirth('2010-01-01', today)).toBe('They must be at least 18.');
    expect(validateDateOfBirth('1800-01-01', today)).toBe('Check the date of birth.');
  });
});

describe('labels and the status line', () => {
  it('knows which payees need a registration number', () => {
    expect(needsRegistrationNumber(2)).toBe(true);
    expect(needsRegistrationNumber(1)).toBe(false);
    expect(registrationLabel(2)).toBe('Charity number');
    expect(registrationLabel(3)).toBe('Company number');
  });
  it('says what is left, in order, and counts in words', () => {
    const bank = saved().bank;
    expect(payoutStatusLine({ status: 1, bank: null, missing: ['bank'] })).toEqual({ ready: false, text: 'One thing left: add the club’s bank account.' });
    expect(payoutStatusLine({ status: 0, bank: null, missing: ['businessType', 'postcode', 'bank'] }).text)
      .toBe('Three things left: add who gets paid, the legal name and address and the club’s bank account.');
    expect(payoutStatusLine({ status: 1, bank, missing: ['personDateOfBirth', 'statementDescriptor'] }).text)
      .toBe('Two things left: add the responsible person and the name on statements.');
    expect(payoutStatusLine({ status: 1, bank, missing: [] })).toEqual({ ready: false, text: 'Nearly there. Finishing set-up…' });
    expect(payoutStatusLine({ status: 1, bank, missing: ['somethingNew'] }).ready).toBe(false);
  });
  it('says where the money goes once it is ready', () => {
    expect(payoutStatusLine({ status: 2, missing: [], bank: { accountHolder: 'x', bankName: null, sortCode: null, maskedAccount: `${BULLETS}1234`, ibanCountry: null } }))
      .toEqual({ ready: true, text: 'Ready. Money from entries goes to account ending 1234.' });
    expect(payoutStatusLine({ status: 2, missing: [], bank: null }).text).toBe('Ready. Money from entries goes to the club’s bank account.');
  });
  it('formats the editor line', () => {
    expect(payoutsLine({ clubName: 'Ashdown PC', maskedAccount: `${BULLETS}1234`, ready: true })).toBe(`Entry fees are paid out to Ashdown PC — ${BULLETS}1234 · Ready`);
    expect(payoutsLine({ clubName: 'Ashdown PC', maskedAccount: null, ready: false })).toBe("Ashdown PC hasn't finished setting up payouts yet.");
  });
  it('describes Stripe Connect status across not_connected, incomplete and ready', () => {
    expect(stripeStatusInfo({ bank: null })).toMatchObject({
      state: 'not_connected',
      badge: 'Not connected',
      buttonLabel: 'Connect bank with Stripe',
    });
    expect(stripeStatusInfo({ stripeConnected: true, stripeChargesEnabled: false, stripePayoutsEnabled: false, bank: null })).toMatchObject({
      state: 'incomplete',
      badge: 'Finish setup on Stripe',
      buttonLabel: 'Continue Stripe setup',
    });
    expect(stripeStatusInfo({
      stripeConnected: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      bank: { accountHolder: 'Ashdown PC', bankName: 'Barclays', sortCode: '20-12-34', maskedAccount: `${BULLETS}9911`, ibanCountry: null },
    })).toMatchObject({
      state: 'ready',
      badge: 'Connected & ready to take payments',
      buttonLabel: 'Update Stripe account',
    });
  });
  it('only allows HTTPS Stripe URLs for onboarding redirects', () => {
    expect(isSafeStripeUrl('https://connect.stripe.com/setup/s/acct_123')).toBe(true);
    expect(isSafeStripeUrl('https://dashboard.stripe.com/connect/accounts')).toBe(true);
    expect(isSafeStripeUrl('http://connect.stripe.com/setup/s/acct_123')).toBe(false);
    expect(isSafeStripeUrl('https://evil-stripe.com/setup')).toBe(false);
    expect(isSafeStripeUrl('https://connect.stripe.com.evil.example/phish')).toBe(false);
    expect(isSafeStripeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeStripeUrl('')).toBe(false);
    expect(isSafeStripeUrl(null)).toBe(false);
  });
});

describe('step and bank problems', () => {
  const form = formFrom(saved());
  it('has no problems for good details', () => {
    for (const step of [1, 2, 3, 5] as const) expect(stepProblems(step, form, today)).toEqual({});
  });
  it('turns a missing form into a form of empty strings', () => {
    const blank = formFrom(saved({ businessType: null, legalName: null, addressLine1: null, addressLine2: null, city: null, postcode: null, contactEmail: null, contactPhone: null, personFullName: null, personDateOfBirth: null, statementDescriptor: null, tradingName: null, vatNumber: null, registrationNumber: null }));
    expect(Object.keys(stepProblems(1, blank, today))).toEqual(['businessType']);
    expect(Object.keys(stepProblems(2, blank, today))).toEqual(['legalName', 'addressLine1', 'city', 'postcode', 'contactEmail', 'contactPhone']);
    expect(Object.keys(stepProblems(3, blank, today))).toEqual(['personFullName', 'personDateOfBirth']);
    expect(Object.keys(stepProblems(5, blank, today))).toEqual(['statementDescriptor']);
  });
  it('wants a charity or company number only for those types, and checks one if given', () => {
    expect(stepProblems(2, { ...form, businessType: 2, registrationNumber: '' }, today).registrationNumber).toBe('Enter the charity number.');
    expect(stepProblems(2, { ...form, businessType: 3, registrationNumber: '' }, today).registrationNumber).toBe('Enter the company number.');
    expect(stepProblems(2, { ...form, businessType: 1, registrationNumber: '' }, today)).toEqual({});
    expect(stepProblems(2, { ...form, businessType: 1, registrationNumber: '12' }, today).registrationNumber).toBeDefined();
    expect(stepProblems(2, { ...form, vatNumber: 'xyz' }, today).vatNumber).toBeDefined();
    expect(stepProblems(2, { ...form, vatNumber: 'GB123456789' }, today)).toEqual({});
  });
  it('checks the bank form for each region without echoing the numbers', () => {
    expect(Object.keys(bankProblems(emptyBank, 0))).toEqual(['accountHolder', 'sortCode', 'accountNumber']);
    expect(Object.keys(bankProblems(emptyBank, 1))).toEqual(['accountHolder', 'iban']);
    expect(bankProblems({ ...emptyBank, accountHolder: 'x'.repeat(151) }, 0).accountHolder).toBe('Use 150 characters or fewer.');
    expect(bankProblems({ accountHolder: 'A', sortCode: '12-34-56', accountNumber: '12345678', iban: '', bic: '' }, 0)).toEqual({});
    expect(bankProblems({ accountHolder: 'A', sortCode: '', accountNumber: '', iban: 'IE29 AIBK 9311 5212 3456 78', bic: 'nope' }, 1)).toEqual({ bic: 'A BIC has 8 or 11 letters and numbers.' });
    for (const message of Object.values(bankProblems({ ...emptyBank, accountHolder: 'A', sortCode: '999', accountNumber: '4242' }, 0))) expect(message).not.toMatch(/4242|999/);
  });
});
