import { describe, expect, it } from 'vitest';
import {
  BASIC_CONFIG, blankExtras, breach, breaches, breachWarning, configProblem, extraIssues, extrasBody, extrasFromEntry, extrasReady,
  isNumberText, limitText, MAX_CUSTOM_FIELDS, newFieldId, parseConfigResponse, STANDARD_CONFIG, weightFields, weightKg,
  type CustomField, type DecFormConfig, type ExtraAnswers,
} from './decFormConfig';

const girth: CustomField = { id: 'girth', label: 'Girth', type: 1, required: false, min: 20, max: 90, unit: 'cm' };
const notes: CustomField = { id: 'notes', label: 'Saddle', type: 0, required: true };
const config = (patch: Partial<DecFormConfig> = {}): DecFormConfig => ({ ...BASIC_CONFIG, ...patch });
const extras = (patch: Partial<ExtraAnswers> = {}): ExtraAnswers => ({ ...blankExtras(), ...patch });

describe('presets', () => {
  it('has the standard form as today’s and the basic form as bare', () => {
    expect(STANDARD_CONFIG).toMatchObject({ dob: 2, ponyHeight: 2, weight: 0, medicalNotes: 0, customFields: [] });
    expect(BASIC_CONFIG).toMatchObject({ dob: 0, ponyHeight: 0, weight: 0 });
  });
});

describe('parseConfigResponse', () => {
  it('reads a good response', () => {
    const parsed = parseConfigResponse({
      config: { ...BASIC_CONFIG, weight: 2, weightUnit: 1, dobFormat: 2, customFields: [{ id: 'g', label: 'Girth', type: 1, required: true, min: 1, max: 9, unit: 'cm' }] },
      isStandard: false, formsSubmitted: 3,
    });
    expect(parsed).toMatchObject({ isStandard: false, formsSubmitted: 3 });
    expect(parsed?.config.weightUnit).toBe(1);
    expect(parsed?.config.dobFormat).toBe(2);
    expect(parsed?.config.customFields[0]).toMatchObject({ id: 'g', type: 1, required: true, max: 9 });
  });

  it('fills gaps with safe defaults and drops broken fields', () => {
    const parsed = parseConfigResponse({ config: { weight: 9, customFields: [{ id: 3 }, null, { id: 'ok', label: 'Fine' }] }, isStandard: true });
    expect(parsed?.config).toMatchObject({ dob: 2, ponyHeight: 2, weight: 0, dobFormat: 0, weightUnit: 0 });
    expect(parsed?.config.customFields).toEqual([{ id: 'ok', label: 'Fine', type: 0, required: false, min: null, max: null, unit: null }]);
    expect(parsed).toMatchObject({ isStandard: true, formsSubmitted: 0 });
  });

  it('refuses anything else', () => {
    expect(parseConfigResponse(null)).toBeNull();
    expect(parseConfigResponse('<html>')).toBeNull();
    expect(parseConfigResponse({})).toBeNull();
    expect(parseConfigResponse({ config: 4 })).toBeNull();
    expect(parseConfigResponse({ config: { customFields: 'no' } })?.config.customFields).toEqual([]);
  });
});

describe('configProblem and newFieldId', () => {
  it('accepts a good setup and explains a bad one', () => {
    expect(configProblem(config({ customFields: [girth, notes] }))).toBeNull();
    expect(configProblem(config({ customFields: [{ ...girth, label: ' ' }] }))).toBe('Give every extra field a name.');
    expect(configProblem(config({ customFields: [{ ...girth, min: 9, max: 3 }] }))).toContain('smallest allowed is bigger');
    expect(configProblem(config({ customFields: Array.from({ length: MAX_CUSTOM_FIELDS + 1 }, (_, i) => ({ ...notes, id: `f${i}` })) }))).toContain('up to');
  });

  it('makes ids that are not in use', () => {
    expect(newFieldId([])).toBe('f1');
    expect(newFieldId([{ ...notes, id: 'f1' }, { ...notes, id: 'f2' }])).toBe('f3');
    expect(newFieldId([{ ...notes, id: 'f2' }])).toBe('f3');
  });
});

describe('weight', () => {
  it('reads kilograms and rejects nonsense', () => {
    expect(weightKg(extras({ weight: '31.5' }), 0)).toBe(31.5);
    expect(weightKg(extras({ weight: '' }), 0)).toBeNull();
    expect(weightKg(extras({ weight: 'abc' }), 0)).toBeNull();
    expect(weightKg(extras({ weight: '2' }), 0)).toBeNull();
    expect(weightKg(extras({ weight: '400' }), 0)).toBeNull();
  });

  it('turns stone and pounds into kilograms', () => {
    expect(weightKg(extras({ weightStone: '5', weight: '4' }), 1)).toBe(33.6);
    expect(weightKg(extras({ weightStone: '5', weight: '' }), 1)).toBe(31.8);
    expect(weightKg(extras({ weightStone: '', weight: '90' }), 1)).toBe(40.8);
    expect(weightKg(extras({ weightStone: '', weight: '' }), 1)).toBeNull();
    expect(weightKg(extras({ weightStone: 'x', weight: '4' }), 1)).toBeNull();
    expect(weightKg(extras({ weightStone: '5', weight: 'y' }), 1)).toBeNull();
  });

  it('shows a stored weight in the form’s unit', () => {
    expect(weightFields(null, 0)).toEqual({ weight: '', weightStone: '' });
    expect(weightFields(undefined, 1)).toEqual({ weight: '', weightStone: '' });
    expect(weightFields(31.5, 0)).toEqual({ weight: '31.5', weightStone: '' });
    expect(weightFields(33.6, 1)).toEqual({ weightStone: '5', weight: '4' });
  });
});

describe('number rules', () => {
  it('tells over, under and fine apart', () => {
    expect(breach(girth, '95')).toBe('over');
    expect(breach(girth, '90')).toBeNull();
    expect(breach(girth, '20')).toBeNull();
    expect(breach(girth, '19.5')).toBe('under');
    expect(breach(girth, '')).toBeNull();
    expect(breach(girth, 'abc')).toBeNull();
    expect(breach(notes, '999')).toBeNull();
    expect(breach({ ...girth, min: null }, '-5')).toBeNull();
    expect(breach({ ...girth, max: null }, '1000')).toBeNull();
  });

  it('words the warning', () => {
    expect(breachWarning('over')).toBe('Above the limit — will be flagged');
    expect(breachWarning('under')).toBe('Below the minimum — will be flagged');
  });

  it('describes the limits', () => {
    expect(limitText(girth)).toBe('Expected 20 to 90 cm');
    expect(limitText({ ...girth, min: null })).toBe('No more than 90 cm');
    expect(limitText({ ...girth, max: null })).toBe('At least 20 cm');
    expect(limitText({ ...girth, min: null, max: null })).toBe('cm');
    expect(limitText({ ...girth, min: null, max: null, unit: null })).toBe('');
  });

  it('lists the breaches for a rider', () => {
    const c = config({ customFields: [girth, notes] });
    expect(breaches(extras({ custom: { girth: '99' } }), c)).toEqual(['Girth: Above the limit — will be flagged']);
    expect(breaches(extras({ custom: { girth: '50' } }), c)).toEqual([]);
  });

  it('knows a number when it sees one', () => {
    expect(isNumberText(' 12.5 ')).toBe(true);
    expect(isNumberText('-3')).toBe(true);
    expect(isNumberText('1e5')).toBe(false);
    expect(isNumberText('')).toBe(false);
  });
});

describe('extraIssues', () => {
  it('asks for nothing on the basic form', () => {
    expect(extraIssues(extras(), false, BASIC_CONFIG)).toEqual({ missing: [], invalid: {} });
  });

  it('names what is missing', () => {
    const c = config({
      dob: 2, dobFormat: 1, weight: 2, ponyPassport: 2, ponyAge: 2, membershipNumber: 2, emergencyContact: 2, medicalNotes: 2,
      customFields: [girth, { ...girth, id: 'req', label: 'Chest', required: true }, notes],
    });
    const issues = extraIssues(extras(), false, c);
    expect(issues.missing).toEqual(['year of birth', 'weight', 'pony passport or ID number', 'pony’s age', 'membership number',
      'emergency contact name and phone', 'medical notes (write “none” if there aren’t any)', 'Chest', 'Saddle']);
    expect(extrasReady(issues)).toBe(false);
  });

  it('skips the pony questions for a reserve', () => {
    const c = config({ ponyPassport: 2, ponyAge: 2 });
    expect(extraIssues(extras(), true, c).missing).toEqual([]);
  });

  it('asks for an age group when that is the format', () => {
    const c = config({ dob: 2, dobFormat: 2 });
    expect(extraIssues(extras(), false, c).missing).toEqual(['age group']);
    expect(extraIssues(extras({ ageGroup: 'U12' }), false, c).missing).toEqual([]);
    expect(extraIssues(extras(), false, config({ dob: 1, dobFormat: 2 })).missing).toEqual([]);
  });

  it('flags badly typed answers', () => {
    const c = config({ dob: 1, dobFormat: 1, weight: 1, ponyAge: 1, emergencyContact: 1, customFields: [girth] });
    const issues = extraIssues(extras({ birthYear: '14', weight: 'x', ponyAge: '1.5', emergencyName: 'Mum', custom: { girth: 'lots' } }), false, c);
    expect(Object.keys(issues.invalid).sort()).toEqual(['birthYear', 'custom:girth', 'emergency', 'ponyAge', 'weight']);
    expect(extraIssues(extras({ birthYear: '1850' }), false, c).invalid.birthYear).toBeDefined();
    expect(extraIssues(extras({ birthYear: '2999' }), false, c, new Date('2026-10-01')).invalid.birthYear).toBeDefined();
    expect(extraIssues(extras({ birthYear: '2014', emergencyName: 'Mum', emergencyPhone: '07700' }), false, c).invalid).toEqual({});
    expect(extraIssues(extras({ emergencyPhone: '07700' }), false, c).invalid.emergency).toBeDefined();
  });

  it('optional answers can be left out', () => {
    const c = config({ weight: 1, ponyAge: 1, emergencyContact: 1, dob: 1, dobFormat: 1 });
    expect(extraIssues(extras(), false, c)).toEqual({ missing: [], invalid: {} });
  });

  it('wants a whole weight in stone and pounds', () => {
    const c = config({ weight: 2, weightUnit: 1 });
    expect(extraIssues(extras({ weightStone: '5' }), false, c)).toEqual({ missing: [], invalid: {} });
    expect(extraIssues(extras({ weightStone: '99', weight: '99' }), false, c).invalid.weight).toBeDefined();
    expect(extraIssues(extras(), false, c).missing).toEqual(['weight']);
  });
});

describe('extrasBody', () => {
  it('sends only the parts that are asked for', () => {
    const answers = extras({
      birthYear: '2014', ageGroup: 'U12', weight: '31.5', ponyPassport: ' P1 ', ponyAge: '9', membershipNumber: ' M1 ',
      emergencyName: 'Mum', emergencyPhone: '07700', medicalNotes: ' asthma ', custom: { girth: ' 50 ', notes: '', ghost: 'x' },
    });
    expect(extrasBody(answers, false, BASIC_CONFIG)).toEqual({
      birthYear: null, ageGroup: null, weightKg: null, ponyPassportNumber: null, ponyAge: null, membershipNumber: null,
      emergencyContactName: null, emergencyContactPhone: null, medicalNotes: null, customValues: null,
    });
    const everything = config({
      dob: 1, dobFormat: 1, weight: 1, ponyPassport: 1, ponyAge: 1, membershipNumber: 1, emergencyContact: 1, medicalNotes: 1, customFields: [girth, notes],
    });
    expect(extrasBody(answers, false, everything)).toEqual({
      birthYear: 2014, ageGroup: null, weightKg: 31.5, ponyPassportNumber: 'P1', ponyAge: 9, membershipNumber: 'M1',
      emergencyContactName: 'Mum', emergencyContactPhone: '07700', medicalNotes: 'asthma', customValues: { girth: '50' },
    });
    expect(extrasBody(answers, true, everything)).toMatchObject({ ponyPassportNumber: null, ponyAge: null });
    expect(extrasBody(answers, false, config({ dob: 1, dobFormat: 2 }))).toMatchObject({ ageGroup: 'U12', birthYear: null });
    expect(extrasBody(extras({ birthYear: 'x', ponyAge: 'y' }), false, everything)).toMatchObject({ birthYear: null, ponyAge: null });
  });
});

describe('extrasFromEntry', () => {
  it('turns a stored rider back into answers', () => {
    expect(extrasFromEntry({ birthYear: 2014, ageGroup: 'U12', weightKg: 33.6, ponyPassportNumber: 'P1', ponyAge: 9, membershipNumber: 'M1',
      emergencyContactName: 'Mum', emergencyContactPhone: '07700', medicalNotes: 'asthma', customValues: { girth: '50', gone: null } }, 1))
      .toEqual({ birthYear: '2014', ageGroup: 'U12', weightStone: '5', weight: '4', ponyPassport: 'P1', ponyAge: '9', membershipNumber: 'M1',
        emergencyName: 'Mum', emergencyPhone: '07700', medicalNotes: 'asthma', custom: { girth: '50' } });
    expect(extrasFromEntry({}, 0)).toEqual(blankExtras());
  });
});
