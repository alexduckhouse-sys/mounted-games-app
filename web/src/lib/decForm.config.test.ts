import { describe, expect, it } from 'vitest';
import type { DeclarationForm, RiderEntry } from '../types';
import { blankRider, buildSubmitBody, canSubmit, phoneProblem, emptySlots, parseDraft, riderIssues, riderReady, slotFlagged, slotMeta, slotsFromForm, type DecRider } from './decForm';
import { BASIC_CONFIG, blankExtras, STANDARD_CONFIG, type DecFormConfig } from './decFormConfig';

const rider = (extra: Partial<DecRider> = {}): DecRider => ({ ...blankRider(), fullName: 'Ella Hughes', pony: 'Pickle', ...extra });
const config = (patch: Partial<DecFormConfig> = {}): DecFormConfig => ({ ...BASIC_CONFIG, ...patch });

describe('riderIssues: the form follows the setup', () => {
  it('needs only a name and a pony on the basic form', () => {
    expect(riderIssues(rider(), false, BASIC_CONFIG)).toEqual({ missing: [], invalid: {} });
    expect(riderReady(rider(), false, undefined, BASIC_CONFIG)).toBe(true);
    expect(riderIssues(rider({ fullName: ' ', pony: '' }), false, BASIC_CONFIG).missing).toEqual(['rider’s name', 'pony’s name']);
    expect(riderReady(rider({ pony: '' }), true, undefined, BASIC_CONFIG)).toBe(true);
  });

  it('still behaves as it always did on the standard form', () => {
    expect(riderIssues(rider(), false).missing).toEqual(['date of birth', 'pony’s height']);
    expect(riderReady(rider({ dob: '05/04/2015', height: '13.2' }), false)).toBe(true);
    expect(riderReady(rider({ dob: '31/02/2015', height: '13.2' }), false)).toBe(false);
    expect(riderIssues(rider({ dob: '31/02/2015', height: '13.5' }), false).invalid).toEqual({
      dob: 'Use dd/mm/yyyy, like 05/04/2015.', height: 'Use hands, like 13.2 (inches run 0 to 3).',
    });
  });

  it('lets optional parts be skipped but checks them when typed', () => {
    const c = config({ dob: 1, ponyHeight: 1 });
    expect(riderReady(rider(), false, undefined, c)).toBe(true);
    expect(riderReady(rider({ dob: 'nope' }), false, undefined, c)).toBe(false);
    expect(riderReady(rider({ height: 'tall' }), false, undefined, c)).toBe(false);
  });

  it('asks for the extra answers the setup names', () => {
    const c = config({ weight: 2, medicalNotes: 2 });
    expect(riderReady(rider(), false, undefined, c)).toBe(false);
    expect(riderReady(rider({ extra: { ...blankExtras(), weight: '31', medicalNotes: 'none' } }), false, undefined, c)).toBe(true);
  });
});

describe('slotMeta follows the setup', () => {
  it('shows only what is asked', () => {
    const r = rider({ dob: '05/04/2015', height: '13.2', extra: { ...blankExtras(), birthYear: '2015', ageGroup: 'U10' } });
    expect(slotMeta(r, false)).toBe('Pickle · 13.2 hh · born 05/04/2015');
    expect(slotMeta(r, false, BASIC_CONFIG)).toBe('Pickle');
    expect(slotMeta(r, false, config({ dob: 2, dobFormat: 1 }))).toBe('Pickle · born 2015');
    expect(slotMeta(r, false, config({ dob: 2, dobFormat: 2 }))).toBe('Pickle · U10');
    expect(slotMeta(rider(), false, config({ dob: 1, dobFormat: 1 }))).toBe('Pickle');
    expect(slotMeta(rider(), false, config({ dob: 1, dobFormat: 2 }))).toBe('Pickle');
    expect(slotMeta(rider(), true, BASIC_CONFIG)).toBe('Non-riding');
  });
});

describe('slotFlagged', () => {
  const c = config({ customFields: [{ id: 'g', label: 'Girth', type: 1, required: false, min: 20, max: 90 }, { id: 't', label: 'Text', type: 0, required: false }] });
  it('is true only for a number outside the limits', () => {
    expect(slotFlagged(rider({ extra: { ...blankExtras(), custom: { g: '95' } } }), c)).toBe(true);
    expect(slotFlagged(rider({ extra: { ...blankExtras(), custom: { g: '50', t: '999' } } }), c)).toBe(false);
    expect(slotFlagged(rider(), c)).toBe(false);
  });
});

describe('buildSubmitBody with a setup', () => {
  it('leaves out the parts that are switched off and adds the extras', () => {
    const slots = emptySlots(1);
    slots[0] = rider({ dob: '05/04/2015', height: '13.2', extra: { ...blankExtras(), weight: '31.5', custom: { g: '95' } } });
    const fields = { teamId: 7, teamName: 'T', bibs: '', trainerName: '', phone: '', notes: '' };
    const c = config({ weight: 2, customFields: [{ id: 'g', label: 'Girth', type: 1, required: false, max: 90 }] });
    const body = buildSubmitBody(fields, slots, c);
    expect(body.riders[0]).toMatchObject({ dateOfBirth: null, ponyHeightHands: null, weightKg: 31.5, customValues: { g: '95' }, medicalNotes: null });
    const standard = buildSubmitBody(fields, slots);
    expect(standard.riders[0]).toMatchObject({ dateOfBirth: '2015-04-05', ponyHeightHands: 13.2, weightKg: null, customValues: null });
    expect(buildSubmitBody(fields, slots, STANDARD_CONFIG).riders[0].dateOfBirth).toBe('2015-04-05');
  });
});

describe('slotsFromForm and drafts carry the extras', () => {
  const entry = (extra: Partial<RiderEntry>): RiderEntry => ({ id: 1, fullName: 'Ella', isCaptain: false, isReserve: false, orderIndex: 0, horseName: 'Pickle', ...extra });
  const form = (riders: RiderEntry[]): DeclarationForm =>
    ({ id: 1, teamId: 7, teamName: 'T', competitionId: 1, competitionName: 'C', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders });

  it('shows a stored weight in the setup’s unit', () => {
    const slots = slotsFromForm(form([entry({ weightKg: 33.6, medicalNotes: 'asthma', customValues: { g: '50' } })]), 1, config({ weight: 1, weightUnit: 1 }));
    expect(slots[0]?.extra).toMatchObject({ weightStone: '5', weight: '4', medicalNotes: 'asthma', custom: { g: '50' } });
  });

  it('reads an older draft that has no extras', () => {
    const old = JSON.stringify({ teamId: 7, teamName: 'T', bibs: '', trainerName: '', phone: '', notes: '', slots: [{ fullName: 'Ella', pony: 'Pickle' }, null] });
    const draft = parseDraft(old, 1);
    expect(draft?.slots[0]?.extra).toEqual(blankExtras());
    const withExtras = JSON.stringify({ teamId: 7, teamName: 'T', bibs: '', trainerName: '', phone: '', notes: '', slots: [{ fullName: 'Ella', extra: { weight: '30' } }, null] });
    expect(parseDraft(withExtras, 1)?.slots[0]?.extra).toMatchObject({ weight: '30', medicalNotes: '' });
  });
});

describe('the trainer’s phone and the bib', () => {
  it('judges the phone by the setup', () => {
    expect(phoneProblem('', BASIC_CONFIG)).toBe('Add a phone number for the trainer.');
    expect(phoneProblem('07123 456789', BASIC_CONFIG)).toBeNull();
    expect(phoneProblem('nope', BASIC_CONFIG)).toContain('UK or Irish');
    expect(phoneProblem('', STANDARD_CONFIG)).toBeNull();
    expect(phoneProblem('nope', config({ trainerPhone: 0 }))).toBeNull();
  });

  it('holds the submit button back for a bad phone', () => {
    const slots = emptySlots(1);
    slots[0] = rider();
    expect(canSubmit(slots, true, 'T')).toBe(true);
    expect(canSubmit(slots, true, 'T', false)).toBe(false);
  });

  it('leaves the phone and bib out of the request when they are off', () => {
    const slots = emptySlots(1);
    slots[0] = rider();
    const fields = { teamId: 7, teamName: 'T', bibs: 'Red', trainerName: '', phone: '07123 456789', notes: '' };
    expect(buildSubmitBody(fields, slots, config({ trainerPhone: 0, bib: 0 }))).toMatchObject({ trainerPhone: null, bibDescription: '' });
    expect(buildSubmitBody(fields, slots, config({ trainerPhone: 1, bib: 1 }))).toMatchObject({ trainerPhone: '07123 456789', bibDescription: 'Red' });
  });
});
