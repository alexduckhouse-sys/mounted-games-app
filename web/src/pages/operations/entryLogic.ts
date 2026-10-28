import { api } from '../../api';
import { tr } from '../../i18n/translate';
import { QR_QUIET_ZONE, qrShape } from '../../lib/qr';
import { displaySectionName } from '../../lib/section';
import type {
  ArrivalWindow, CompetitionEntrySettings, FeeDisposition, MarkClubPaidResult, SectionSignup, SendUnpaidRemindersResult,
} from '../../types';
import type { TreasurerOrderRow } from '../../lib/treasurerCsv';

/** Which bucket an entry sits in for the organiser's filter. Waiting-list and withdrawn entries never count as paid or pending. */
export type SignupBucket = 'paid' | 'pending' | 'waitlist' | 'withdrawn';
export type EntryFilter = 'all' | SignupBucket;

export function signupBucket(s: Pick<SectionSignup, 'status' | 'isWaitlist' | 'isWithdrawn'>): SignupBucket {
  if (s.isWithdrawn || s.status === 2 || s.status === 3) return 'withdrawn';
  if (s.isWaitlist) return 'waitlist';
  return s.status === 1 ? 'paid' : 'pending';
}

export function bucketCounts(signups: SectionSignup[]): Record<EntryFilter, number> {
  const counts: Record<EntryFilter, number> = { all: signups.length, paid: 0, pending: 0, waitlist: 0, withdrawn: 0 };
  for (const s of signups) counts[signupBucket(s)] += 1;
  return counts;
}

export const FILTERS: Array<{ value: EntryFilter; label: string }> = [
  { value: 'all', get label() { return tr('ops2.entries.f.all'); } },
  { value: 'paid', get label() { return tr('ops2.entries.f.paid'); } },
  { value: 'pending', get label() { return tr('ops2.entries.pendingPayment'); } },
  { value: 'waitlist', get label() { return tr('ops2.entries.f.waitlist'); } },
  { value: 'withdrawn', get label() { return tr('ops2.protest.withdrawn'); } },
];

export const ARRIVAL_OPTIONS: Array<{ value: ArrivalWindow | ''; label: string }> = [
  { value: '', get label() { return tr('ops2.entries.arr.none'); } },
  { value: 'FridayEvening', get label() { return tr('ops2.entries.arr.fri'); } },
  { value: 'SaturdayMorning', get label() { return tr('ops2.entries.arr.sat'); } },
  { value: 'Other', get label() { return tr('ops2.entries.arr.other'); } },
];

export const FEE_DISPOSITION_OPTIONS: Array<{ value: FeeDisposition; label: string; hint: string }> = [
  { value: 'None', get label() { return tr('ops2.entries.fee.none'); }, get hint() { return tr('ops2.entries.fee.noneHint'); } },
  { value: 'RefundPending', get label() { return tr('ops2.entries.fee.pending'); }, get hint() { return tr('ops2.entries.fee.pendingHint'); } },
  { value: 'Refunded', get label() { return tr('ops2.entries.fee.refunded'); }, get hint() { return tr('ops2.entries.fee.refundedHint'); } },
  { value: 'Retained', get label() { return tr('ops2.entries.fee.kept'); }, get hint() { return tr('ops2.entries.fee.keptHint'); } },
  { value: 'CreditRollover', get label() { return tr('ops2.entries.fee.credit'); }, get hint() { return tr('ops2.entries.fee.creditHint'); } },
];

export const dispositionLabel = (d: FeeDisposition | undefined): string => FEE_DISPOSITION_OPTIONS.find((o) => o.value === (d ?? 'None'))?.label ?? tr('ops2.entries.fee.none');

/** A reminder goes out at most once a day to the same entry. */
export const REMINDER_COOLDOWN_HOURS = 24;

/** Whole hours (rounded up) before this entry can be reminded again; 0 when it can be reminded now. */
export function reminderHoursLeft(lastReminderSentAt: string | null | undefined, now: Date = new Date()): number {
  if (!lastReminderSentAt) return 0;
  const sent = new Date(lastReminderSentAt).getTime();
  if (!Number.isFinite(sent)) return 0;
  const left = REMINDER_COOLDOWN_HOURS - (now.getTime() - sent) / 3_600_000;
  return left > 0 ? Math.ceil(left) : 0;
}

export type WaitlistOfferState = { state: 'none' } | { state: 'open'; text: string } | { state: 'expired'; text: string };

/** The state of a waiting-list spot offer, with "5h 20m left" text. */
export function waitlistOfferState(expiresAt: string | null | undefined, now: Date = new Date()): WaitlistOfferState {
  if (!expiresAt) return { state: 'none' };
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end)) return { state: 'none' };
  const ms = end - now.getTime();
  if (ms <= 0) return { state: 'expired', text: tr('ops2.entries.offerRanOut') };
  const { h, m } = offerTimeLeft(ms);
  return { state: 'open', text: h > 0 ? tr('ops2.entries.hmLeft', { h, m }) : tr('ops2.sponsors.mLeft', { m }) };
}

/** Whole hours and minutes left of an offer, rounding up to the minute (at least one), for text in any language. */
export function offerTimeLeft(ms: number): { h: number; m: number } {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/** Pounds typed by hand ("12", "12.5", "£12.50") to pence, or null when it isn't an amount. Avoids float rounding. */
export function poundsToMinor(text: string): number | null {
  const m = /^£?\s*(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

export function minorToPounds(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** A short plain-text summary for a group chat: counts only, no names or contact details. */
export function entriesSummaryText(competitionName: string, signups: SectionSignup[], capacity: CompetitionEntrySettings | null): string {
  const counts = bucketCounts(signups);
  const bySection = new Map<string, number>();
  for (const s of signups) {
    if (signupBucket(s) === 'paid' || signupBucket(s) === 'pending') {
      const name = displaySectionName(s.sectionName);
      bySection.set(name, (bySection.get(name) ?? 0) + 1);
    }
  }
  const lines = [tr('ops2.entries.summaryTitle', { name: competitionName }), tr('ops2.entries.summaryCounts', { paid: counts.paid, pending: counts.pending, waitlist: counts.waitlist, withdrawn: counts.withdrawn })];
  for (const [name, n] of bySection) lines.push(`${name}: ${n}`);
  const cap = capacityLines(capacity);
  if (cap.length > 0) lines.push(cap.join(' · '));
  return lines.join('\n');
}

/** "Stables 8 of 20 booked", "Hook-ups 3 booked"; empty when nothing has been booked or limited. */
export function capacityLines(c: CompetitionEntrySettings | null): string[] {
  if (!c) return [];
  const line = (label: string, booked: number | undefined, max: number | null | undefined) => {
    if (max != null && max > 0) return tr('ops2.entries.cap.of', { label, booked: booked ?? 0, max });
    return booked ? tr('ops2.entries.cap.booked', { label, booked }) : '';
  };
  return [line(tr('ops2.entries.cap.stables'), c.stablesBooked, c.maxStables), line(tr('ops2.entries.cap.hookups'), c.hookupsBooked, c.maxHookups)].filter(Boolean);
}

/** The stabling pass's QR code as inline SVG markup for the printable page. */
export function qrSvgMarkup(value: string): string {
  const shape = qrShape(value);
  if (!shape) return '';
  const total = shape.size + QR_QUIET_ZONE * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${tr('ops2.entries.passQr')}" width="160" height="160" viewBox="${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${total} ${total}" shape-rendering="crispEdges"><rect x="${-QR_QUIET_ZONE}" y="${-QR_QUIET_ZONE}" width="${total}" height="${total}" fill="#fff"/><path d="${shape.path}" fill="#000"/></svg>`;
}

/* ---- API calls (all staff-only; the server checks access to the competition) ---- */

export async function fetchEntrySettings(competitionId: number): Promise<CompetitionEntrySettings | null> {
  const { data } = await api.get<CompetitionEntrySettings>(`/competitions/${competitionId}/entry-settings`);
  return data && typeof data === 'object' ? data : null;
}

export async function fetchShopOrders(competitionId: number): Promise<TreasurerOrderRow[]> {
  const { data } = await api.get<TreasurerOrderRow[]>(`/commerce/competitions/${competitionId}/orders`);
  return Array.isArray(data) ? data : [];
}

export async function sendUnpaidReminders(competitionId: number, signupIds: number[], customNote: string | null): Promise<SendUnpaidRemindersResult> {
  const { data } = await api.post<SendUnpaidRemindersResult>(`/competitions/${competitionId}/signups/send-unpaid-reminders`, { signupIds, customNote: customNote?.trim() || null });
  return data;
}

/** Staff may change an entry's arrival window and vehicle through the same route the entrant uses. */
export async function saveSignupArrival(signupId: number, arrivalWindow: ArrivalWindow | null, vehicleRegistration: string | null): Promise<void> {
  await api.put(`/my/signups/${signupId}/arrival`, { arrivalWindow, vehicleRegistration });
}

export async function saveSignupDisposition(competitionId: number, signupId: number, feeDisposition: FeeDisposition, refundedAmountMinor: number | null, dispositionNote: string | null): Promise<void> {
  await api.put(`/competitions/${competitionId}/signups/${signupId}/disposition`, { feeDisposition, refundedAmountMinor, dispositionNote: dispositionNote?.trim() || null });
}

export async function offerWaitlistSpot(competitionId: number, signupId: number): Promise<void> {
  await api.post(`/competitions/${competitionId}/signups/${signupId}/offer-waitlist-spot`, {});
}

export async function markSignupPaid(competitionId: number, signupId: number): Promise<void> {
  await api.post(`/competitions/${competitionId}/signups/${signupId}/mark-paid`);
}

export async function markOrderPaid(orderId: number): Promise<void> {
  await api.post(`/commerce/orders/${orderId}/manual-payment`, { confirmedExternally: true });
}

export async function markClubPaid(competitionId: number, ponyClubName: string, signupIds: number[], sendReceiptEmail: boolean): Promise<MarkClubPaidResult> {
  const { data } = await api.post<MarkClubPaidResult>(`/competitions/${competitionId}/signups/mark-club-paid`, { ponyClubName, signupIds, sendReceiptEmail });
  return data;
}
