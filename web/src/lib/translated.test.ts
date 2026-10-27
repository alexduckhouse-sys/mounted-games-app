import { afterEach, describe, expect, it } from 'vitest';
import { setActiveLang } from '../i18n/translate';
import { bankDetailsText } from './bankDetails';
import { emptySlots, panelTitle, phoneProblem, riderIssues, blankRider, sendReason } from './decForm';
import { STANDARD_CONFIG, breachWarning, limitText, type CustomField } from './decFormConfig';
import { formBanner, lockHeading, lockMoment } from './decFormDeadline';
import { entryOptions, entryTitle, feeText, feesLine } from './entryOptions';
import { priceLabel } from './money';
import { friendlyPasswordErrors, PASSWORD_RULES } from './passwordRules';
import { placesLeftText } from './placesLeft';
import { roleLabel } from './profile';

afterEach(() => setActiveLang('en'));

describe('Welsh', () => {
  it('translates fees, entry choices and titles', () => {
    setActiveLang('cy');
    expect(feeText(0)).toBe('Am ddim');
    expect(feeText(1500)).toBe('£15');
    expect(priceLabel(0)).toBe('Am ddim');
    expect(entryOptions({ format: 2, priceMinor: 1500 }).map((o) => o.label)).toEqual(['Tîm', 'Marchog gwadd']);
    expect(feesLine({ format: 1, priceMinor: 2000 }, true)).toBe('Llawn · Rhestr aros');
    expect(entryTitle({ format: 1, displayName: 'Under 12' }, 'standard')).toBe('Under 12 · pâr');
  });

  it('counts places left with one form for every number', () => {
    setActiveLang('cy');
    expect(placesLeftText({ format: 2, maxParticipants: 10, activeSignupsCount: 4 })).toBe('6 lle tîm ar ôl');
    expect(placesLeftText({ format: 2, maxParticipants: 10, activeSignupsCount: 9 })).toBe('1 lle tîm ar ôl');
  });

  it('names the sort of password problem', () => {
    setActiveLang('cy');
    expect(PASSWORD_RULES[0].label).toBe('O leiaf 8 nod');
    expect(friendlyPasswordErrors({ errorCodes: ['PasswordRequiresDigit'] })).toEqual(['Mae angen rhif ar eich cyfrinair.']);
  });

  it('gives roles, dec form guidance and bank lines', () => {
    setActiveLang('cy');
    expect(roleLabel(['Trainer'])).toBe('Hyfforddwr');
    expect(sendReason(emptySlots(5), false, '', null, false, false)).toBe('Ychwanegwch 4 marchog arall i’w anfon.');
    expect(panelTitle(emptySlots(5), 0)).toBe('Ychwanegu marchog');
    expect(bankDetailsText({ payTo: 'Sort 00-00', reference: 'Team A', amount: '£15' })).toContain('Talu i: Sort 00-00');
  });
});

describe('French', () => {
  it('translates fees, entry choices and places left with singular and plural', () => {
    setActiveLang('fr');
    expect(feeText(null)).toBe('Gratuit');
    expect(entryOptions({ format: 1, priceMinor: 2000 }).map((o) => o.label)).toEqual(['Paire', 'Cavalier seul']);
    expect(placesLeftText({ format: 1, maxParticipants: 4, activeSignupsCount: 3 })).toBe('1 place de paire restante');
    expect(placesLeftText({ format: 3, maxParticipants: 8, activeSignupsCount: 2 })).toBe('6 places de cavalier restantes');
    expect(entryTitle({ format: 3, displayName: 'Juniors' }, 'guest')).toBe('Juniors · cavalier invité');
  });

  it('describes what a rider is missing and what is typed badly', () => {
    setActiveLang('fr');
    const { missing, invalid } = riderIssues({ ...blankRider(), dob: '31/02/2015' }, false);
    expect(missing).toEqual(['nom du cavalier', 'nom du poney', 'taille du poney']);
    expect(invalid.dob).toBe('Utilisez jj/mm/aaaa, par exemple 05/04/2015.');
    expect(phoneProblem('abc', { ...STANDARD_CONFIG, trainerPhone: 1 })).toBe('Saisissez un numéro britannique ou irlandais, par exemple 07123 456789.');
  });

  it('warns about limits in words', () => {
    setActiveLang('fr');
    const girth: CustomField = { id: 'g', label: 'Girth', type: 1, required: false, min: 20, max: 90, unit: 'cm' };
    expect(breachWarning('over')).toBe('Au-dessus de la limite — sera signalé');
    expect(limitText(girth)).toBe('Attendu : 20 à 90 cm');
    expect(limitText({ ...girth, min: null })).toBe('Pas plus de 90 cm');
    expect(limitText({ ...girth, max: null })).toBe('Au moins 20 cm');
  });

  it('writes deadlines with French day names and 24-hour times', () => {
    setActiveLang('fr');
    const iso = '2026-10-23T18:00:00';
    expect(lockMoment(iso)).toMatch(/^ven\.? 23 oct\.?, 18:00$/);
    expect(lockHeading({ declarationsCloseAt: iso, isClosed: true })).toBe('Verrouillé');
    expect(formBanner(false, { declarationsCloseAt: null, isClosed: false }).text).toBe('Pas encore envoyé.');
    expect(formBanner(true, { declarationsCloseAt: iso, isClosed: false }).text).toMatch(/^Envoyé\. Vous pouvez le modifier jusqu’au ven/);
  });
});
