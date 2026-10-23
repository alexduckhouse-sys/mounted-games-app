/**
 * What a competition's dec form asks, and the rules the rider panel applies to it. The base form (rider, pony,
 * bib or number, trainer) is always there; everything in `DecFormConfig` is added to it by the organiser.
 * Mirrors `api/Services/DecForms/DecFormConfig.cs`; enums travel as numbers.
 */

/** Off, optional or required. */
export type Requirement = 0 | 1 | 2;
export const OFF: Requirement = 0;
export const OPTIONAL: Requirement = 1;
export const REQUIRED: Requirement = 2;

/** Full date, birth year only, or age group only. */
export type DobFormat = 0 | 1 | 2;
/** Kilograms, or stone and pounds (always stored as kilograms). */
export type WeightUnit = 0 | 1;
export type CustomFieldType = 0 | 1;
export const TEXT_FIELD: CustomFieldType = 0;
export const NUMBER_FIELD: CustomFieldType = 1;

export interface CustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  min?: number | null;
  max?: number | null;
  unit?: string | null;
}

export interface DecFormConfig {
  dob: Requirement;
  dobFormat: DobFormat;
  weight: Requirement;
  weightUnit: WeightUnit;
  ponyHeight: Requirement;
  ponyPassport: Requirement;
  ponyAge: Requirement;
  membershipNumber: Requirement;
  emergencyContact: Requirement;
  medicalNotes: Requirement;
  customFields: CustomField[];
  /** The coach's phone number, once per team. */
  trainerPhone: Requirement;
  /** The team's bib or number description. */
  bib: Requirement;
}

/** What the API sends for `GET /competitions/:id/dec-form-config`. */
export interface DecFormConfigResponse {
  config: DecFormConfig;
  /** True when the organiser never set one up, so the standard form is in use. */
  isStandard: boolean;
  /** Dec forms already in. A change applies to new submissions only. */
  formsSubmitted: number;
}

/** Today's form, kept for competitions that never set one up: date of birth and pony height, nothing else added. */
export const STANDARD_CONFIG: DecFormConfig = {
  dob: REQUIRED, dobFormat: 0, weight: OFF, weightUnit: 0, ponyHeight: REQUIRED, ponyPassport: OFF, ponyAge: OFF,
  membershipNumber: OFF, emergencyContact: OFF, medicalNotes: OFF, customFields: [],
  trainerPhone: OPTIONAL, bib: OPTIONAL,
};

/** The bare base form: the starting point when an organiser builds their own. */
export const BASIC_CONFIG: DecFormConfig = { ...STANDARD_CONFIG, dob: OFF, ponyHeight: OFF, trainerPhone: REQUIRED, bib: OFF };

export const MAX_CUSTOM_FIELDS = 12;

const isRequirement = (v: unknown): v is Requirement => v === 0 || v === 1 || v === 2;

/** The response, checked before use; null when it isn't the shape we expect (an HTML page, an older API). */
export function parseConfigResponse(data: unknown): DecFormConfigResponse | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as { config?: Partial<DecFormConfig> | null; isStandard?: unknown; formsSubmitted?: unknown };
  const raw = value.config;
  if (!raw || typeof raw !== 'object') return null;
  const requirement = (v: unknown, fallback: Requirement): Requirement => (isRequirement(v) ? v : fallback);
  const fields = Array.isArray(raw.customFields) ? raw.customFields : [];
  const config: DecFormConfig = {
    dob: requirement(raw.dob, STANDARD_CONFIG.dob),
    dobFormat: raw.dobFormat === 1 || raw.dobFormat === 2 ? raw.dobFormat : 0,
    weight: requirement(raw.weight, OFF),
    weightUnit: raw.weightUnit === 1 ? 1 : 0,
    ponyHeight: requirement(raw.ponyHeight, STANDARD_CONFIG.ponyHeight),
    ponyPassport: requirement(raw.ponyPassport, OFF),
    ponyAge: requirement(raw.ponyAge, OFF),
    membershipNumber: requirement(raw.membershipNumber, OFF),
    emergencyContact: requirement(raw.emergencyContact, OFF),
    medicalNotes: requirement(raw.medicalNotes, OFF),
    trainerPhone: requirement(raw.trainerPhone, STANDARD_CONFIG.trainerPhone),
    bib: requirement(raw.bib, STANDARD_CONFIG.bib),
    customFields: fields.filter((f): f is CustomField => !!f && typeof f.id === 'string' && typeof f.label === 'string')
      .map((f) => ({ id: f.id, label: f.label, type: f.type === 1 ? 1 : 0, required: !!f.required, min: f.min ?? null, max: f.max ?? null, unit: f.unit ?? null })),
  };
  return { config, isStandard: value.isStandard === true, formsSubmitted: typeof value.formsSubmitted === 'number' ? value.formsSubmitted : 0 };
}

export const asked = (r: Requirement): boolean => r !== OFF;

/** A short, unique id for a new custom field. */
export function newFieldId(existing: readonly CustomField[]): string {
  let n = existing.length + 1;
  while (existing.some((f) => f.id === `f${n}`)) n++;
  return `f${n}`;
}

/** Why a setup can't be saved yet, in plain words, or null. Mirrors the API's checks so the message comes before the request. */
export function configProblem(config: DecFormConfig): string | null {
  if (config.customFields.length > MAX_CUSTOM_FIELDS) return `A dec form can have up to ${MAX_CUSTOM_FIELDS} extra fields.`;
  for (const f of config.customFields) {
    if (!f.label.trim()) return 'Give every extra field a name.';
    if (f.type === NUMBER_FIELD && f.min != null && f.max != null && f.min > f.max) return `For “${f.label.trim()}”, the smallest allowed is bigger than the largest.`;
  }
  return null;
}

// ----- what the trainer types -----

/** One rider's answers to the parts above, as typed. */
export interface ExtraAnswers {
  birthYear: string;
  ageGroup: string;
  /** Kilograms, or the pounds part of stone and pounds when the form shows those. */
  weight: string;
  weightStone: string;
  ponyPassport: string;
  ponyAge: string;
  membershipNumber: string;
  emergencyName: string;
  emergencyPhone: string;
  medicalNotes: string;
  custom: Record<string, string>;
}

export const blankExtras = (): ExtraAnswers => ({
  birthYear: '', ageGroup: '', weight: '', weightStone: '', ponyPassport: '', ponyAge: '', membershipNumber: '',
  emergencyName: '', emergencyPhone: '', medicalNotes: '', custom: {},
});

const LB_PER_KG = 2.2046226218;

/** Kilograms to one decimal for a weight typed in the form's unit, or null if it isn't a sensible number. */
export function weightKg(extras: Pick<ExtraAnswers, 'weight' | 'weightStone'>, unit: WeightUnit): number | null {
  const number = (text: string) => (/^\d{1,3}(\.\d{1,2})?$/.test(text.trim()) ? Number(text) : null);
  let kg: number | null;
  if (unit === 0) {
    kg = number(extras.weight);
  } else {
    const stone = extras.weightStone.trim() === '' ? 0 : number(extras.weightStone);
    const pounds = extras.weight.trim() === '' ? 0 : number(extras.weight);
    if (stone === null || pounds === null || (stone === 0 && pounds === 0)) return null;
    kg = (stone * 14 + pounds) / LB_PER_KG;
  }
  if (kg === null) return null;
  const rounded = Math.round(kg * 10) / 10;
  return rounded >= 5 && rounded <= 250 ? rounded : null;
}

/** The fields to show when editing a stored weight: kilograms, or stone and pounds. */
export function weightFields(kg: number | null | undefined, unit: WeightUnit): Pick<ExtraAnswers, 'weight' | 'weightStone'> {
  if (kg == null) return { weight: '', weightStone: '' };
  if (unit === 0) return { weight: String(kg), weightStone: '' };
  const totalPounds = Math.round(kg * LB_PER_KG);
  return { weightStone: String(Math.floor(totalPounds / 14)), weight: String(totalPounds % 14) };
}

/** True when text is a plain number. */
export const isNumberText = (text: string): boolean => /^-?\d+(\.\d+)?$/.test(text.trim());

/** What a number does to the organiser's rule: `'over'`, `'under'`, or null when it's fine or can't be judged. */
export function breach(field: CustomField, text: string): 'over' | 'under' | null {
  if (field.type !== NUMBER_FIELD || !isNumberText(text)) return null;
  const value = Number(text);
  if (field.max != null && value > field.max) return 'over';
  if (field.min != null && value < field.min) return 'under';
  return null;
}

/** The amber warning shown while a trainer types a number that breaks the rule. */
export function breachWarning(kind: 'over' | 'under'): string {
  return kind === 'over' ? 'Above the limit — will be flagged' : 'Below the minimum — will be flagged';
}

export function limitText(field: CustomField): string {
  const unit = field.unit?.trim() ? ` ${field.unit.trim()}` : '';
  if (field.min != null && field.max != null) return `Expected ${field.min} to ${field.max}${unit}`;
  if (field.max != null) return `No more than ${field.max}${unit}`;
  if (field.min != null) return `At least ${field.min}${unit}`;
  return unit.trim();
}

/** The rule breaches among a rider's custom answers, as the sentences the trainer is warned with. */
export function breaches(extras: ExtraAnswers, config: DecFormConfig): string[] {
  return config.customFields.flatMap((field) => {
    const kind = breach(field, extras.custom[field.id] ?? '');
    return kind ? [`${field.label}: ${breachWarning(kind)}`] : [];
  });
}

/** Names of the required answers still missing, and bad entries, for one rider. */
export interface ExtraIssues {
  missing: string[];
  invalid: Record<string, string>;
}

export function extraIssues(extras: ExtraAnswers, reserve: boolean, config: DecFormConfig, today: Date = new Date()): ExtraIssues {
  const missing: string[] = [];
  const invalid: Record<string, string> = {};
  const blank = (t: string) => t.trim() === '';

  if (asked(config.dob) && config.dobFormat === 1) {
    if (blank(extras.birthYear)) { if (config.dob === REQUIRED) missing.push('year of birth'); }
    else if (!/^\d{4}$/.test(extras.birthYear.trim()) || Number(extras.birthYear) < 1900 || Number(extras.birthYear) > today.getFullYear()) invalid.birthYear = 'Enter a four-digit year, like 2014.';
  }
  if (asked(config.dob) && config.dobFormat === 2 && blank(extras.ageGroup) && config.dob === REQUIRED) missing.push('age group');

  if (asked(config.weight)) {
    const empty = blank(extras.weight) && (config.weightUnit === 0 || blank(extras.weightStone));
    if (empty) { if (config.weight === REQUIRED) missing.push('weight'); }
    else if (weightKg(extras, config.weightUnit) === null) invalid.weight = 'That doesn’t look like a weight.';
  }

  if (!reserve) {
    if (config.ponyPassport === REQUIRED && blank(extras.ponyPassport)) missing.push('pony passport or ID number');
    if (asked(config.ponyAge)) {
      if (blank(extras.ponyAge)) { if (config.ponyAge === REQUIRED) missing.push('pony’s age'); }
      else if (!/^\d{1,2}$/.test(extras.ponyAge.trim())) invalid.ponyAge = 'Enter the age in whole years.';
    }
  }

  if (config.membershipNumber === REQUIRED && blank(extras.membershipNumber)) missing.push('membership number');
  if (asked(config.emergencyContact)) {
    const none = blank(extras.emergencyName) && blank(extras.emergencyPhone);
    if (none) { if (config.emergencyContact === REQUIRED) missing.push('emergency contact name and phone'); }
    else if (blank(extras.emergencyName) || blank(extras.emergencyPhone)) invalid.emergency = 'Give both a name and a phone number, or leave both blank.';
  }
  if (config.medicalNotes === REQUIRED && blank(extras.medicalNotes)) missing.push('medical notes (write “none” if there aren’t any)');

  for (const field of config.customFields) {
    const text = extras.custom[field.id] ?? '';
    if (blank(text)) { if (field.required) missing.push(field.label.trim()); }
    else if (field.type === NUMBER_FIELD && !isNumberText(text)) invalid[`custom:${field.id}`] = 'Enter a number.';
  }
  return { missing, invalid };
}

export const extrasReady = (issues: ExtraIssues): boolean => issues.missing.length === 0 && Object.keys(issues.invalid).length === 0;

/** The body fields the API takes for a rider's extra answers; parts that are switched off are left out. */
export function extrasBody(extras: ExtraAnswers, reserve: boolean, config: DecFormConfig) {
  const text = (v: string) => v.trim() || null;
  const custom: Record<string, string> = {};
  for (const field of config.customFields) {
    const value = (extras.custom[field.id] ?? '').trim();
    if (value) custom[field.id] = value;
  }
  const dobKind = asked(config.dob) ? config.dobFormat : -1;
  return {
    birthYear: dobKind === 1 && /^\d{4}$/.test(extras.birthYear.trim()) ? Number(extras.birthYear) : null,
    ageGroup: dobKind === 2 ? text(extras.ageGroup) : null,
    weightKg: asked(config.weight) ? weightKg(extras, config.weightUnit) : null,
    ponyPassportNumber: !reserve && asked(config.ponyPassport) ? text(extras.ponyPassport) : null,
    ponyAge: !reserve && asked(config.ponyAge) && /^\d{1,2}$/.test(extras.ponyAge.trim()) ? Number(extras.ponyAge) : null,
    membershipNumber: asked(config.membershipNumber) ? text(extras.membershipNumber) : null,
    emergencyContactName: asked(config.emergencyContact) ? text(extras.emergencyName) : null,
    emergencyContactPhone: asked(config.emergencyContact) ? text(extras.emergencyPhone) : null,
    medicalNotes: asked(config.medicalNotes) ? text(extras.medicalNotes) : null,
    customValues: Object.keys(custom).length ? custom : null,
  };
}

/** A stored rider's answers, ready to edit. */
export function extrasFromEntry(entry: {
  birthYear?: number | null; ageGroup?: string | null; weightKg?: number | null; ponyPassportNumber?: string | null;
  ponyAge?: number | null; membershipNumber?: string | null; emergencyContactName?: string | null;
  emergencyContactPhone?: string | null; medicalNotes?: string | null; customValues?: Record<string, string | null> | null;
}, unit: WeightUnit): ExtraAnswers {
  const custom: Record<string, string> = {};
  for (const [id, value] of Object.entries(entry.customValues ?? {})) if (value != null) custom[id] = value;
  return {
    birthYear: entry.birthYear == null ? '' : String(entry.birthYear),
    ageGroup: entry.ageGroup ?? '',
    ...weightFields(entry.weightKg, unit),
    ponyPassport: entry.ponyPassportNumber ?? '',
    ponyAge: entry.ponyAge == null ? '' : String(entry.ponyAge),
    membershipNumber: entry.membershipNumber ?? '',
    emergencyName: entry.emergencyContactName ?? '',
    emergencyPhone: entry.emergencyContactPhone ?? '',
    medicalNotes: entry.medicalNotes ?? '',
    custom,
  };
}

/**
 * A UK or Irish phone number tidied the way the API does it ("+44 (0)7123 456-789" becomes "+447123456789"), or null if it
 * doesn't look like one. Friendly rather than strict: it checks the shape, not that the number exists.
 */
export function normalisePhone(text: string): string | null {
  let value = text.trim().replace('(0)', '').replace(/[\s\-.()]/g, '');
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (!/^\+?\d+$/.test(value)) return null;
  if (!value.startsWith('+')) return value.startsWith('0') && value.length >= 9 && value.length <= 11 ? value : null;
  const prefix = value.startsWith('+44') ? '+44' : value.startsWith('+353') ? '+353' : null;
  if (!prefix) return null;
  let digits = value.slice(prefix.length);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length >= 7 && digits.length <= 10 ? prefix + digits : null;
}

export const PHONE_HELP = 'Enter a UK or Irish number, like 07123 456789.';

/** The words for a requirement, for the organiser's pickers. */
export const REQUIREMENT_LABELS: Record<Requirement, string> = { 0: 'Off', 1: 'Optional', 2: 'Required' };
