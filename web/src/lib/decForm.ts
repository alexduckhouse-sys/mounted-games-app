import { tr } from '../i18n/translate';
import type { DeclarationForm, RiderEntry, SavedRider, SavedTeamDeclaration, SectionFormat } from '../types';
import { formatBibWithFlag, parseBibAndFlag } from './bib';
import {
  asked, blankExtras, normalisePhone, phoneHelp, breach, extraIssues, extrasBody, extrasFromEntry, extrasReady, STANDARD_CONFIG, type DecFormConfig, type ExtraAnswers,
} from './decFormConfig';

/**
 * The dec form screen's rules, kept apart from the page so they can be tested: a team of five riders and a
 * non-riding reserve, a rider panel that fills one slot at a time, and the request the API takes.
 * The slots are an array one longer than the number of riders needed; the last one is the reserve.
 */

/** One person in a slot. The first six fields are what the panel asks for; the rest ride along unseen. */
export interface DecRider {
  savedRiderId: number | null;
  fullName: string;
  /** As typed, dd/mm/yyyy. */
  dob: string;
  pony: string;
  /** As typed, in hands: 13.2 is 13 hands 2 inches. */
  height: string;
  /** Optional full name of the pony's owner, used to match vet/official equine certification. */
  ponyOwnerFullName?: string;
  isCaptain: boolean;
  useInitialOnly: boolean;
  noFilming: boolean;
  isGuestRider: boolean;
  /** Answers to the parts the organiser added (weight, passport number, their own questions and so on). */
  extra: ExtraAnswers;
}

export type Slot = DecRider | null;

/** A team of five riders is the norm; a pair has two and an individual one. */
export function ridersRequired(format: SectionFormat | undefined): number {
  return format === 1 ? 2 : format === 3 ? 1 : 5;
}

/** Only a team (4-5 riders) has a 6th reserve slot; pairs (2) and individuals (1) have no reserve slot. */
export function hasReserveSlotForRiders(riders: number): boolean {
  return riders >= 4;
}

export function emptySlots(riders: number): Slot[] {
  return Array.from({ length: hasReserveSlotForRiders(riders) ? riders + 1 : riders }, () => null);
}

export const isReserveSlot = (slots: readonly Slot[], index: number): boolean =>
  slots.length >= 6 && index === slots.length - 1;

export const ridingSlotsCount = (slots: readonly Slot[]): number =>
  slots.length >= 6 ? slots.length - 1 : slots.length;

export const minRidersForSlots = (slots: readonly Slot[]): number => {
  const riding = ridingSlotsCount(slots);
  return riding >= 5 ? 4 : riding;
};

export function blankRider(): DecRider {
  return { savedRiderId: null, fullName: '', dob: '', pony: '', height: '', ponyOwnerFullName: '', isCaptain: false, useInitialOnly: false, noFilming: false, isGuestRider: false, extra: blankExtras() };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** dd/mm/yyyy for a date the API sent (`2015-04-05T00:00:00` or `2015-04-05`); empty when there isn't one. */
export function dobText(iso: string | null | undefined): string {
  const match = ISO_DATE.exec(iso ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/** `yyyy-mm-dd` for typed dd/mm/yyyy, or null when it isn't a real date that has already happened. */
export function parseDob(text: string, today: Date = new Date()): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 1900 || date.getTime() > Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Hands as a number (13.2), or null. Inches run 0 to 3, and the API takes 5 to 20 hands. */
export function parseHeight(text: string): number | null {
  const match = /^(\d{1,2})(?:\.(\d))?$/.exec(text.trim());
  if (!match) return null;
  const hands = Number(match[1]);
  const inches = Number(match[2] ?? 0);
  if (inches > 3 || hands < 5 || hands > 20 || (hands === 20 && inches > 0)) return null;
  return Number(`${hands}.${inches}`);
}

export const heightText = (hands: number | null | undefined): string => (hands == null ? '' : hands.toFixed(1));

/**
 * What the form is still missing for one rider, and what is typed badly. The base form is the name and, for a riding
 * slot, the pony; the date of birth and height follow the competition's setup (the standard form asks for both).
 */
export function riderIssues(rider: DecRider, reserve: boolean, config: DecFormConfig = STANDARD_CONFIG, today?: Date) {
  const issues = extraIssues(rider.extra, reserve, config, today);
  const missing = [...issues.missing];
  const invalid = { ...issues.invalid };
  if (!rider.fullName.trim()) missing.unshift(tr('entries.dec.missingName'));
  if (asked(config.dob) && config.dobFormat === 0) {
    if (rider.dob.trim() === '') { if (config.dob === 2) missing.push(tr('entries.dec.missingDob')); }
    else if (parseDob(rider.dob, today) === null) invalid.dob = tr('entries.dec.badDob');
  }
  if (!reserve) {
    if (rider.pony.trim() === '') missing.push(tr('entries.dec.missingPony'));
    if (asked(config.ponyHeight)) {
      if (rider.height.trim() === '') { if (config.ponyHeight === 2) missing.push(tr('entries.dec.missingHeight')); }
      else if (parseHeight(rider.height) === null) invalid.height = tr('entries.dec.badHeight');
    }
  }
  if (reserve && asked(config.ponyHeight) && rider.height.trim() !== '' && parseHeight(rider.height) === null) {
    invalid.height = tr('entries.dec.badHeight');
  }
  return { missing, invalid };
}

/** Whether the rider panel can add this rider. */
export function riderReady(rider: DecRider, reserve: boolean, today?: Date, config: DecFormConfig = STANDARD_CONFIG): boolean {
  return extrasReady(riderIssues(rider, reserve, config, today));
}

export function riderFromSaved(saved: SavedRider, reserve: boolean): DecRider {
  return {
    ...blankRider(),
    savedRiderId: saved.id,
    fullName: saved.fullName,
    dob: dobText(saved.dateOfBirth),
    // The reserve doesn't have to ride, so a saved pony isn't copied across by default.
    pony: reserve ? '' : saved.horseName ?? '',
    height: reserve ? '' : heightText(saved.ponyHeightHands),
    ponyOwnerFullName: reserve ? '' : saved.ponyOwnerFullName ?? '',
    useInitialOnly: saved.useInitialOnly ?? false,
    noFilming: saved.noFilming ?? false,
    extra: {
      ...blankExtras(),
      ponyPassport: reserve ? '' : saved.ponyPassportNumber ?? '',
    },
  };
}

function riderFromEntry(entry: RiderEntry, config: DecFormConfig): DecRider {
  return {
    savedRiderId: entry.savedRiderId ?? null,
    fullName: entry.fullName,
    dob: dobText(entry.dateOfBirth),
    pony: entry.horseName ?? '',
    height: heightText(entry.ponyHeightHands),
    ponyOwnerFullName: entry.ponyOwnerFullName ?? '',
    isCaptain: entry.isCaptain,
    useInitialOnly: entry.useInitialOnly ?? false,
    noFilming: entry.noFilming ?? false,
    isGuestRider: entry.isGuestRider ?? false,
    extra: extrasFromEntry(entry, config.weightUnit),
  };
}

/**
 * The slots for a team that already has a declaration. A form from before this screen can hold more than the
 * usual number of riders; they all keep a slot so nobody is dropped when it is sent again.
 */
export function slotsFromForm(form: DeclarationForm, required: number, config: DecFormConfig = STANDARD_CONFIG): Slot[] {
  const ordered = form.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const reserve = hasReserveSlotForRiders(required) ? ordered.find((r) => r.isReserve) : undefined;
  const riding = ordered.filter((r) => r !== reserve && !r.isReserve);
  const slots = emptySlots(Math.max(required, riding.length));
  riding.forEach((entry, i) => { slots[i] = riderFromEntry(entry, config); });
  if (reserve) slots[slots.length - 1] = riderFromEntry(reserve, config);
  return slots;
}

export function normaliseSlotsForFormat(slots: readonly Slot[], format: SectionFormat | undefined): Slot[] {
  const required = ridersRequired(format);
  const target = emptySlots(required);
  const riding = slots.filter((_s, i) => !isReserveSlot(slots, i));
  for (let i = 0; i < Math.min(required, riding.length); i++) {
    target[i] = riding[i];
  }
  if (hasReserveSlotForRiders(required) && slots.length >= 6) {
    target[target.length - 1] = slots[slots.length - 1];
  }
  return target;
}

export function firstEmpty(slots: readonly Slot[]): number | null {
  const index = slots.findIndex((s) => !s);
  return index < 0 ? null : index;
}

export const ridersAdded = (slots: readonly Slot[]): number =>
  slots.filter((s, i) => !isReserveSlot(slots, i) && Boolean(s)).length;

export const teamIsFull = (slots: readonly Slot[]): boolean =>
  ridersAdded(slots) >= minRidersForSlots(slots);

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The club's saved riders who aren't already somewhere in this team. */
export function savedChoices(saved: readonly SavedRider[], slots: readonly Slot[]): SavedRider[] {
  const inTeam = slots.filter((s): s is DecRider => !!s);
  return saved.filter((s) => !inTeam.some((r) => r.savedRiderId === s.id || sameName(r.fullName, s.fullName)));
}

/** The second line of a filled slot: "Pickle · 13.2 hh · born 05/04/2015". Only what the form asks is shown. */
export function slotMeta(rider: DecRider, reserve: boolean, config: DecFormConfig = STANDARD_CONFIG): string {
  const born = !asked(config.dob) ? null
    : config.dobFormat === 1 ? (rider.extra.birthYear ? tr('entries.dec.born', { value: rider.extra.birthYear }) : null)
      : config.dobFormat === 2 ? (rider.extra.ageGroup ? rider.extra.ageGroup : null)
        : rider.dob ? tr('entries.dec.born', { value: rider.dob }) : null;
  const parts = reserve && (!rider.pony.trim() || !rider.height.trim()) ? [tr('entries.dec.nonRiding'), born] : [rider.pony, asked(config.ponyHeight) && rider.height ? `${rider.height} hh` : null, born];
  return parts.filter(Boolean).join(' · ');
}

/** True when a rider in the slot has an answer that breaks one of the organiser's number rules. */
export function slotFlagged(rider: DecRider, config: DecFormConfig): boolean {
  return config.customFields.some((f) => f.type === 1 && breach(f, rider.extra.custom[f.id] ?? '') !== null);
}

export function slotLabel(slots: readonly Slot[], index: number): string {
  return isReserveSlot(slots, index) ? tr('entries.dec.nonRidingReserve') : tr('entries.dec.rider');
}

export function panelTitle(slots: readonly Slot[], index: number): string {
  const editing = !!slots[index];
  return isReserveSlot(slots, index) ? (editing ? tr('entries.dec.editReserve') : tr('entries.dec.addNonRidingReserve')) : (editing ? tr('entries.dec.editRider') : tr('entries.dec.addARider'));
}

/**
 * The line under the send button: what is still missing, in the order the person would fix it, or what sending does.
 * `unchanged` is true when the form was sent and nothing has been touched since.
 */
export function sendReason(slots: readonly Slot[], agreed: boolean, teamName: string, phoneIssue: string | null, sent: boolean, unchanged: boolean): string {
  const missing = minRidersForSlots(slots) - ridersAdded(slots);
  if (missing > 0) return tr('entries.dec.addMoreRiders', { count: missing });
  if (teamName.trim() === '') return tr('entries.dec.needTeamName');
  if (phoneIssue) return phoneIssue;
  if (!agreed) return tr('entries.dec.needAgree');
  if (unchanged) return tr('entries.dec.unchanged');
  return sent ? tr('entries.dec.resendReplaces') : tr('entries.dec.ready');
}

/** "3 of 5 · reserve optional": how many riders are in, for the Riders heading. */
export function ridersCount(slots: readonly Slot[]): string {
  const need = minRidersForSlots(slots);
  const base = `${tr('entries.dec.countOf', { added: ridersAdded(slots), total: ridingSlotsCount(slots) })}${need < ridingSlotsCount(slots) ? ` · ${tr('entries.dec.countNeeded', { need })}` : ''}`;
  return slots.length >= 6 ? `${base} · ${tr('entries.dec.reserveOptional')}` : base;
}

/** The label of the one add bar: the next free slot ("Add rider 4", "Add a reserve"), or null when every slot is full. */
export function addLabel(slots: readonly Slot[]): string | null {
  const index = firstEmpty(slots);
  if (index == null) return null;
  return isReserveSlot(slots, index) ? tr('entries.dec.addReserveRow') : tr('entries.dec.addRiderN', { n: index + 1 });
}

export function canSubmit(slots: readonly Slot[], agreed: boolean, teamName: string, phoneOk = true): boolean {
  return teamIsFull(slots) && agreed && teamName.trim() !== '' && phoneOk;
}

/** What is wrong with the trainer's phone number, in friendly words, or null when it is fine (or not asked for). */
export function phoneProblem(phone: string, config: DecFormConfig): string | null {
  if (!asked(config.trainerPhone)) return null;
  if (phone.trim() === '') return config.trainerPhone === 2 ? tr('entries.dec.phoneNeeded') : null;
  return normalisePhone(phone) === null ? phoneHelp() : null;
}

export interface DecFormFields {
  teamId: number;
  teamName: string;
  bibs: string;
  flag?: string;
  trainerName: string;
  phone: string;
  notes: string;
}

/** The body of `POST /declaration-forms`. Ticking the terms is the only way to get here, so it is always true. */
export function buildSubmitBody(fields: DecFormFields, slots: readonly Slot[], config: DecFormConfig = STANDARD_CONFIG) {
  const riders = slots.flatMap((rider, index) => {
    if (!rider) return [];
    const reserve = isReserveSlot(slots, index);
    return [{
      savedRiderId: rider.savedRiderId,
      fullName: rider.fullName.trim(),
      dateOfBirth: asked(config.dob) && config.dobFormat === 0 ? parseDob(rider.dob) : null,
      horseName: rider.pony.trim() || null,
      ponyHeightHands: !asked(config.ponyHeight) ? null : parseHeight(rider.height),
      bibColour: null,
      isCaptain: rider.isCaptain,
      isReserve: reserve,
      isGuestRider: rider.isGuestRider,
      useInitialOnly: rider.useInitialOnly,
      noFilming: rider.noFilming,
      orderIndex: index,
      ponyOwnerFullName: reserve ? null : (rider.ponyOwnerFullName?.trim() || null),
      ...extrasBody(rider.extra, reserve, config),
    }];
  });
  const rawBib = asked(config.bib) ? fields.bibs.trim() : '';
  return {
    teamId: fields.teamId,
    teamName: fields.teamName.trim(),
    bibDescription: formatBibWithFlag(rawBib, fields.flag),
    trainerName: fields.trainerName.trim() || null,
    trainerPhone: asked(config.trainerPhone) ? fields.phone.trim() || null : null,
    notes: fields.notes.trim() || null,
    // New riders go on the club's roster so they can be picked next time.
    saveToRoster: true,
    acceptTerms: true,
    riders,
  };
}

/** What is kept on the device while a dec form is half done. The terms tick is never kept. */
export interface DecFormDraft extends Omit<DecFormFields, 'teamId'> {
  teamId: number;
  slots: Slot[];
}

/** One draft per team, so opening another team never writes over unfinished work. */
export const decDraftKey = (competitionId: number, teamId: number): string => `mg.draft.decform.v2:${competitionId}:${teamId}`;

export function parseDraft(raw: string | null, required: number): DecFormDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DecFormDraft> | null;
    if (!value || typeof value.teamId !== 'number' || !Array.isArray(value.slots) || value.slots.length < emptySlots(required).length) return null;
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    const slots = value.slots.map((s): Slot => (s && typeof s === 'object' ? { ...blankRider(), ...s, extra: { ...blankExtras(), ...(s.extra ?? {}) } } : null));
    return {
      teamId: value.teamId, teamName: text(value.teamName), bibs: text(value.bibs), flag: text(value.flag), trainerName: text(value.trainerName),
      phone: text(value.phone), notes: text(value.notes), slots,
    };
  } catch {
    return null;
  }
}

/** The line under the team name: "U10 · Cheshire Area MG · Sat 24 Oct". Parts that are missing are left out. */
export function subtitleOf(parts: readonly (string | null | undefined)[]): string {
  return parts.map((p) => p?.trim()).filter(Boolean).join(' · ');
}

/** Warning raised when a rider from a saved team looks older than the target section's age band. */
export interface SavedTeamAgeWarning {
  slotIndex: number;
  riderName: string;
  birthYear: number;
  ageInCompetitionYear: number;
  maxAge: number;
  message: string;
}

export interface AppliedSavedTeamResult {
  slots: Slot[];
  teamName: string;
  bibs: string;
  flag: string;
  trainerName: string;
  phone: string;
  ageWarnings: SavedTeamAgeWarning[];
}

/**
 * Extracts the maximum age (as of 1 January / competition year) from a section or age-group label such as
 * `"U12"`, `"Under 15"`, `"U17 Pairs"`, or `"Junior"` (U15). Returns `null` for Open / Senior sections.
 */
export function parseAgeGroupMaxAge(ageGroupOrSection: string | null | undefined): number | null {
  const raw = ageGroupOrSection?.trim() ?? '';
  if (!raw) return null;
  const underMatch = /\b(?:u|under[\s-]*)(\d{1,2})\b/i.exec(raw);
  if (underMatch) {
    const n = Number(underMatch[1]);
    return n >= 6 && n <= 25 ? n : null;
  }
  if (/\bjunior\b/i.test(raw)) return 15;
  return null;
}

function birthYearFromRider(rider: DecRider): number | null {
  const dobMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rider.dob.trim());
  if (dobMatch) return Number(dobMatch[3]);
  if (/^\d{4}$/.test(rider.extra.birthYear.trim())) return Number(rider.extra.birthYear.trim());
  return null;
}

/**
 * Readable label for a saved team in the "Auto-fill from a previous team" picker, e.g.
 * `"Kent A · U15 · Summer Champs (5 riders)"`.
 */
export function savedTeamSummaryLabel(savedTeam: SavedTeamDeclaration): string {
  const ridingCount = savedTeam.riders.filter((r) => !r.isReserve).length;
  const reserveCount = savedTeam.riders.filter((r) => r.isReserve).length;
  const countText = reserveCount > 0 ? tr('entries.dec.ridersReserve', { count: ridingCount }) : tr('entries.riders', { count: ridingCount });
  const head = subtitleOf([savedTeam.entryTeamName || savedTeam.teamName, savedTeam.ageGroup || savedTeam.sectionName, savedTeam.competitionName]);
  return `${head} (${countText})`;
}

/**
 * Applies a previously declared team (`SavedTeamDeclaration`) onto a declaration form for `targetFormat`,
 * copying riders, ponies, heights, privacy flags, bib/flag, and trainer contact while checking whether any
 * rider exceeds the target section's age band for `competitionYear`.
 */
export function applySavedTeamToForm(
  savedTeam: SavedTeamDeclaration,
  targetFormat: SectionFormat | undefined,
  config: DecFormConfig = STANDARD_CONFIG,
  options?: {
    targetAgeGroup?: string | null;
    competitionYear?: number | null;
  },
): AppliedSavedTeamResult {
  const required = ridersRequired(targetFormat);
  const ordered = savedTeam.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const reserveEntry = hasReserveSlotForRiders(required) ? ordered.find((r) => r.isReserve) : undefined;
  const ridingEntries = ordered.filter((r) => r !== reserveEntry && !r.isReserve);

  const slots = emptySlots(required);
  for (let i = 0; i < Math.min(required, ridingEntries.length); i++) {
    slots[i] = riderFromEntry(ridingEntries[i], config);
  }
  if (reserveEntry && hasReserveSlotForRiders(required)) {
    slots[slots.length - 1] = riderFromEntry(reserveEntry, config);
  }

  const parsedBib = parseBibAndFlag(savedTeam.bibDescription);
  const maxAge = parseAgeGroupMaxAge(options?.targetAgeGroup);
  const compYear = options?.competitionYear ?? null;
  const ageWarnings: SavedTeamAgeWarning[] = [];

  if (maxAge !== null && compYear !== null && compYear >= 2000) {
    slots.forEach((slot, idx) => {
      if (!slot) return;
      const birthYear = birthYearFromRider(slot);
      if (birthYear === null) return;
      const ageInCompYear = compYear - birthYear;
      if (ageInCompYear > maxAge) {
        ageWarnings.push({
          slotIndex: idx,
          riderName: slot.fullName,
          birthYear,
          ageInCompetitionYear: ageInCompYear,
          maxAge,
          message: tr('entries.dec.ageWarning', { name: slot.fullName, age: ageInCompYear, year: compYear, max: maxAge }),
        });
      }
    });
  }

  return {
    slots,
    teamName: (savedTeam.entryTeamName || savedTeam.teamName || '').trim(),
    bibs: parsedBib.bib,
    flag: parsedBib.flag ?? '',
    trainerName: (savedTeam.trainerName ?? '').trim(),
    phone: (savedTeam.trainerPhone ?? '').trim(),
    ageWarnings,
  };
}
