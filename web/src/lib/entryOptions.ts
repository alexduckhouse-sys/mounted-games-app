import type { MessageKey } from '../i18n/en';
import { tr } from '../i18n/translate';
import type { CompetitionSection } from '../types';
import { displaySectionName } from './section';

/**
 * What a person can enter in an age group.
 *  - `standard`: the section's own entry (a team, a pair or an individual).
 *  - `guest`: a guest rider with no team yet. Free, and nothing to pay.
 *  - `partner`: a solo rider looking for a pair partner, at half the pair fee.
 *  - `waitlist`: the free waiting list, once the section is full.
 */
export type EntryKind = 'standard' | 'guest' | 'partner' | 'waitlist';

export interface EntryOption {
  kind: EntryKind;
  label: string;
  /** A line under the label. */
  sub?: string;
  priceMinor: number;
}

export const ENTRY_KINDS: readonly EntryKind[] = ['standard', 'guest', 'partner', 'waitlist'];

export function parseEntryKind(value: string | null | undefined): EntryKind | null {
  return ENTRY_KINDS.find((kind) => kind === value) ?? null;
}

/** "£15", "£15.50" or "Free". */
export function feeText(priceMinor: number | null | undefined): string {
  if (!priceMinor || priceMinor <= 0) return tr('entries.fee.free');
  const pounds = priceMinor / 100;
  return `£${Number.isInteger(pounds) ? pounds : pounds.toFixed(2)}`;
}

const STANDARD_LABEL: Record<number, MessageKey> = { 1: 'entries.kind.pair', 2: 'entries.kind.team', 3: 'entries.kind.individual' };

/** The choices for one age group, in the order they are shown. A full section only offers the waiting list. */
export function entryOptions(section: Pick<CompetitionSection, 'format' | 'priceMinor'>, full = false): EntryOption[] {
  const price = section.priceMinor ?? 0;
  const guest: EntryOption = { kind: 'guest', label: tr('entries.kind.guest'), sub: tr('entries.kind.guestSub'), priceMinor: 0 };
  const waitlist: EntryOption = { kind: 'waitlist', label: tr('entries.kind.waitlist'), sub: tr('entries.kind.waitlistSub'), priceMinor: 0 };
  if (full) return section.format === 2 ? [waitlist, guest] : [waitlist];
  const standard: EntryOption = { kind: 'standard', label: tr(STANDARD_LABEL[section.format] ?? 'entries.kind.entry'), priceMinor: price };
  if (section.format === 2) return [standard, guest];
  if (section.format === 1) {
    return [standard, { kind: 'partner', label: tr('entries.kind.solo'), sub: tr('entries.kind.soloSub'), priceMinor: Math.floor(price / 2) }];
  }
  return [standard];
}

/** The fees on one line, for example "Team £15 · Guest rider Free". A full age group says so first. */
export function feesLine(section: Pick<CompetitionSection, 'format' | 'priceMinor'>, full = false): string {
  const line = entryOptions(section, full).map((option) => (option.kind === 'waitlist' ? tr('entries.fees.waitingList') : `${option.label} ${feeText(option.priceMinor)}`)).join(' · ');
  return full ? tr('entries.fees.full', { line }) : line;
}

/** True when every place is taken. Only known when the API sent the count with the section. */
export function sectionFull(section: Pick<CompetitionSection, 'maxParticipants' | 'activeSignupsCount'>): boolean {
  return section.maxParticipants != null && section.activeSignupsCount != null && section.activeSignupsCount >= section.maxParticipants;
}

/** Remaining admission places from the API's paid/pending count; null means capacity is unknown or uncapped. */
export function remainingPlaces(section: Pick<CompetitionSection, 'maxParticipants' | 'activeSignupsCount'>): number | null {
  const cap = section.maxParticipants;
  const taken = section.activeSignupsCount;
  if (cap == null || taken == null || !Number.isSafeInteger(cap) || cap <= 0 || !Number.isSafeInteger(taken) || taken < 0) return null;
  return Math.max(0, cap - taken);
}

/** Whether an entry has anything to pay, and so a third step. */
export function needsPayStep(priceMinor: number): boolean {
  return priceMinor > 0;
}

const STANDARD_NOUN: Record<number, MessageKey> = { 1: 'entries.noun.pair', 2: 'entries.noun.team', 3: 'entries.noun.rider' };

/** The title of the details step: "Juniors · team", "Under 12 · guest rider". */
export function entryTitle(section: Pick<CompetitionSection, 'format' | 'displayName'>, kind: EntryKind): string {
  const noun = tr(kind === 'guest' ? 'entries.noun.guest' : kind === 'partner' ? 'entries.noun.solo' : kind === 'waitlist' ? 'entries.noun.waitlist' : STANDARD_NOUN[section.format] ?? 'entries.noun.entry');
  return `${displaySectionName(section.displayName)} · ${noun}`;
}
