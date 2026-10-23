import type { DeclarationForm, RiderEntry, SavedRider, SectionFormat } from '../types';

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
  isCaptain: boolean;
  useInitialOnly: boolean;
  noFilming: boolean;
  isGuestRider: boolean;
}

export type Slot = DecRider | null;

/** A team of five riders is the norm; a pair has two and an individual one. */
export function ridersRequired(format: SectionFormat | undefined): number {
  return format === 1 ? 2 : format === 3 ? 1 : 5;
}

export function emptySlots(riders: number): Slot[] {
  return Array.from({ length: riders + 1 }, () => null);
}

export const isReserveSlot = (slots: readonly Slot[], index: number): boolean => index === slots.length - 1;

export function blankRider(): DecRider {
  return { savedRiderId: null, fullName: '', dob: '', pony: '', height: '', isCaptain: false, useInitialOnly: false, noFilming: false, isGuestRider: false };
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

/** Name and birth date for anyone; a riding slot also needs the pony and its height. */
export function riderReady(rider: DecRider, reserve: boolean, today?: Date): boolean {
  if (!rider.fullName.trim() || parseDob(rider.dob, today) === null) return false;
  return reserve || (rider.pony.trim() !== '' && parseHeight(rider.height) !== null);
}

export function riderFromSaved(saved: SavedRider, reserve: boolean): DecRider {
  return {
    ...blankRider(),
    savedRiderId: saved.id,
    fullName: saved.fullName,
    dob: dobText(saved.dateOfBirth),
    // The reserve doesn't ride, so a saved pony isn't copied across.
    pony: reserve ? '' : saved.horseName ?? '',
    height: reserve ? '' : heightText(saved.ponyHeightHands),
    useInitialOnly: saved.useInitialOnly ?? false,
    noFilming: saved.noFilming ?? false,
  };
}

function riderFromEntry(entry: RiderEntry): DecRider {
  return {
    savedRiderId: entry.savedRiderId ?? null,
    fullName: entry.fullName,
    dob: dobText(entry.dateOfBirth),
    pony: entry.horseName ?? '',
    height: heightText(entry.ponyHeightHands),
    isCaptain: entry.isCaptain,
    useInitialOnly: entry.useInitialOnly ?? false,
    noFilming: entry.noFilming ?? false,
    isGuestRider: entry.isGuestRider ?? false,
  };
}

/**
 * The slots for a team that already has a declaration. A form from before this screen can hold more than the
 * usual number of riders; they all keep a slot so nobody is dropped when it is sent again.
 */
export function slotsFromForm(form: DeclarationForm, required: number): Slot[] {
  const ordered = form.riders.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const reserve = ordered.find((r) => r.isReserve);
  const riding = ordered.filter((r) => r !== reserve);
  const slots = emptySlots(Math.max(required, riding.length));
  riding.forEach((entry, i) => { slots[i] = riderFromEntry(entry); });
  if (reserve) slots[slots.length - 1] = riderFromEntry(reserve);
  return slots;
}

export function firstEmpty(slots: readonly Slot[]): number | null {
  const index = slots.findIndex((s) => !s);
  return index < 0 ? null : index;
}

export const ridersAdded = (slots: readonly Slot[]): number => slots.slice(0, -1).filter(Boolean).length;
export const teamIsFull = (slots: readonly Slot[]): boolean => ridersAdded(slots) === slots.length - 1;

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The club's saved riders who aren't already somewhere in this team. */
export function savedChoices(saved: readonly SavedRider[], slots: readonly Slot[]): SavedRider[] {
  const inTeam = slots.filter((s): s is DecRider => !!s);
  return saved.filter((s) => !inTeam.some((r) => r.savedRiderId === s.id || sameName(r.fullName, s.fullName)));
}

/** The second line of a filled slot: "Pickle · 13.2 hh · born 05/04/2015". */
export function slotMeta(rider: DecRider, reserve: boolean): string {
  const born = `born ${rider.dob}`;
  return reserve ? `Non-riding · ${born}` : `${rider.pony} · ${rider.height} hh · ${born}`;
}

export function slotLabel(slots: readonly Slot[], index: number): string {
  return isReserveSlot(slots, index) ? 'Non-riding reserve (optional)' : 'Rider';
}

export function panelTitle(slots: readonly Slot[], index: number): string {
  const editing = !!slots[index];
  return isReserveSlot(slots, index) ? (editing ? 'Edit reserve' : 'Add a non-riding reserve') : (editing ? 'Edit rider' : 'Add a rider');
}

export function statusText(slots: readonly Slot[], agreed: boolean, submitted: boolean): string {
  if (submitted) return 'Submitted';
  if (teamIsFull(slots)) return agreed ? 'Ready to submit' : 'Tick to agree, then submit';
  return `${ridersAdded(slots)} of ${slots.length - 1} riders added`;
}

export function canSubmit(slots: readonly Slot[], agreed: boolean, teamName: string): boolean {
  return teamIsFull(slots) && agreed && teamName.trim() !== '';
}

export interface DecFormFields {
  teamId: number;
  teamName: string;
  bibs: string;
  trainerName: string;
  phone: string;
  notes: string;
}

/** The body of `POST /declaration-forms`. Ticking the terms is the only way to get here, so it is always true. */
export function buildSubmitBody(fields: DecFormFields, slots: readonly Slot[]) {
  const riders = slots.flatMap((rider, index) => {
    if (!rider) return [];
    const reserve = isReserveSlot(slots, index);
    return [{
      savedRiderId: rider.savedRiderId,
      fullName: rider.fullName.trim(),
      dateOfBirth: parseDob(rider.dob),
      horseName: reserve ? null : rider.pony.trim() || null,
      ponyHeightHands: reserve ? null : parseHeight(rider.height),
      bibColour: null,
      isCaptain: rider.isCaptain,
      isReserve: reserve,
      isGuestRider: rider.isGuestRider,
      useInitialOnly: rider.useInitialOnly,
      noFilming: rider.noFilming,
      orderIndex: index,
    }];
  });
  return {
    teamId: fields.teamId,
    teamName: fields.teamName.trim(),
    bibDescription: fields.bibs.trim(),
    trainerName: fields.trainerName.trim() || null,
    trainerPhone: fields.phone.trim() || null,
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
    if (!value || typeof value.teamId !== 'number' || !Array.isArray(value.slots) || value.slots.length < required + 1) return null;
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    const slots = value.slots.map((s): Slot => (s && typeof s === 'object' ? { ...blankRider(), ...s } : null));
    return {
      teamId: value.teamId, teamName: text(value.teamName), bibs: text(value.bibs), trainerName: text(value.trainerName),
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
