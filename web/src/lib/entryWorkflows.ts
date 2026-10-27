import { toCsv } from './csv';
import { priceLabel } from './money';
import { displaySectionName } from './section';
import type {
  ArrivalWindow,
  ClubInvoiceGroup,
  FeeDisposition,
  FeeDispositionLedgerSummary,
  MySignup,
  SectionSignup,
} from '../types';

export interface UnpaidReminderCandidate {
  signup: SectionSignup;
  hasEmail: boolean;
  defaultSelected: boolean;
  paymentReference: string;
}

/** Lists all active Pending signups with a positive fee, pre-selecting those with a contact email. */
export function unpaidReminderCandidates(competitionId: number, signups: SectionSignup[]): UnpaidReminderCandidate[] {
  return signups
    .filter((s) => s.status === 0 && s.amountMinor > 0 && !s.isWaitlist && !s.isWithdrawn)
    .map((signup) => {
      const hasEmail = Boolean(signup.contactEmail?.trim());
      return {
        signup,
        hasEmail,
        defaultSelected: hasEmail,
        paymentReference: `MG-${competitionId}-${signup.id}`,
      };
    });
}

export function defaultSelectedReminderIds(competitionId: number, signups: SectionSignup[]): number[] {
  return unpaidReminderCandidates(competitionId, signups)
    .filter((c) => c.defaultSelected)
    .map((c) => c.signup.id);
}

/** Upper-cases and trims a horsebox or vehicle registration, or returns null when blank. */
export function normaliseVehicleReg(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().toUpperCase();
  return trimmed.length > 0 ? trimmed.slice(0, 40) : null;
}

export function arrivalWindowLabel(window: ArrivalWindow | null | undefined): string {
  if (window === 'FridayEvening') return 'Friday evening';
  if (window === 'SaturdayMorning') return 'Saturday morning';
  return 'Other / not specified';
}

export interface GroupedArrivalManifest {
  fridayEvening: SectionSignup[];
  saturdayMorning: SectionSignup[];
  other: SectionSignup[];
}

/** Groups active stabling/arrival signups into Friday evening, Saturday morning, and Other. */
export function groupArrivalManifest(signups: SectionSignup[]): GroupedArrivalManifest {
  const fridayEvening: SectionSignup[] = [];
  const saturdayMorning: SectionSignup[] = [];
  const other: SectionSignup[] = [];

  for (const s of signups) {
    if (s.isWithdrawn || s.isWaitlist || s.status === 2 || s.status === 3) continue;
    const hasStables = (s.stablesCount ?? 0) > 0;
    const hasArrival = Boolean(s.arrivalWindow);
    const hasVehicle = Boolean(s.vehicleRegistration?.trim());
    if (!hasStables && !hasArrival && !hasVehicle) continue;

    if (s.arrivalWindow === 'FridayEvening') fridayEvening.push(s);
    else if (s.arrivalWindow === 'SaturdayMorning') saturdayMorning.push(s);
    else other.push(s);
  }

  return { fridayEvening, saturdayMorning, other };
}

/** Builds a CSV manifest of arrival windows and horsebox registrations for gate stewards. */
export function arrivalManifestCsv(signups: SectionSignup[]): string {
  const { fridayEvening, saturdayMorning, other } = groupArrivalManifest(signups);
  const ordered = [...fridayEvening, ...saturdayMorning, ...other];
  const header = ['Arrival window', 'Vehicle registration', 'Club or team', 'Entrant', 'Section', 'Teams', 'Stables', 'Payment status'];
  const rows: Array<Array<string | number>> = [];
  for (const s of ordered) {
    const clubOrTeam = (s.stablingClubOrTeam || s.ponyClubName || s.teamName || 'Unaffiliated').trim();
    const statusText = s.status === 1 ? 'Paid' : 'Pending';
    rows.push([
      arrivalWindowLabel(s.arrivalWindow),
      s.vehicleRegistration?.trim() || '',
      clubOrTeam,
      s.fullName,
      displaySectionName(s.sectionName),
      Math.max(1, s.teamsCount ?? 1),
      s.stablesCount ?? 0,
      statusText,
    ]);
  }
  return toCsv(header, rows);
}

/** Resolves the effective fee disposition for a signup, falling back to status/refundPending flags. */
export function effectiveFeeDisposition(
  signup: Pick<SectionSignup, 'status' | 'refundPending' | 'feeDisposition'>,
): FeeDisposition {
  if (signup.feeDisposition && signup.feeDisposition !== 'None') return signup.feeDisposition;
  if (signup.status === 2) return 'Refunded';
  if (signup.refundPending) return 'RefundPending';
  return 'None';
}

/** Computes the Refund, Retained-Fee and Credit Ledger totals and eligible rows. */
export function computeFeeDispositionLedger(signups: SectionSignup[]): FeeDispositionLedgerSummary {
  let totalRetainedMinor = 0;
  let totalRefundedMinor = 0;
  let refundsPendingMinor = 0;
  let creditsRolledOverMinor = 0;
  const rows: SectionSignup[] = [];

  for (const s of signups) {
    const disposition = effectiveFeeDisposition(s);
    const isLedgerRow = Boolean(s.isWithdrawn) || s.status === 2 || s.status === 3 || disposition !== 'None';
    if (!isLedgerRow) continue;

    rows.push({ ...s, feeDisposition: disposition });
    if (disposition === 'Retained') {
      totalRetainedMinor += s.amountMinor;
    } else if (disposition === 'Refunded') {
      const rawRefund = s.refundedAmountMinor ?? s.amountMinor;
      const refunded = Math.max(0, Math.min(s.amountMinor, rawRefund));
      totalRefundedMinor += refunded;
      if (refunded < s.amountMinor) {
        totalRetainedMinor += s.amountMinor - refunded;
      }
    } else if (disposition === 'RefundPending') {
      refundsPendingMinor += s.amountMinor;
    } else if (disposition === 'CreditRollover') {
      creditsRolledOverMinor += s.amountMinor;
    }
  }

  return {
    totalRetainedMinor,
    totalRefundedMinor,
    refundsPendingMinor,
    creditsRolledOverMinor,
    rows,
  };
}

/** Normalises a Pony Club name into an uppercase alphanumeric slug (max 16 chars) for BACS references. */
export function buildClubSlug(ponyClubName: string | null | undefined): string {
  const cleaned = (ponyClubName ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16)
    .replace(/-+$/g, '');
  return cleaned || 'CLUB';
}

export function buildClubBacsReference(competitionId: number, ponyClubName: string | null | undefined): string {
  return `MGC-${competitionId}-${buildClubSlug(ponyClubName)}`;
}

/** Groups active signups by PonyClubName when a club has 2+ signups across sections in the competition. */
export function groupClubInvoices(competitionId: number, signups: SectionSignup[]): ClubInvoiceGroup[] {
  const byClub = new Map<string, SectionSignup[]>();
  for (const s of signups) {
    if (s.isWithdrawn || s.isWaitlist || (s.status !== 0 && s.status !== 1)) continue;
    const club = (s.ponyClubName ?? '').trim();
    if (!club || club.toLowerCase() === 'unaffiliated') continue;
    const key = club.toLowerCase();
    const list = byClub.get(key) ?? [];
    list.push(s);
    byClub.set(key, list);
  }

  return [...byClub.values()]
    .filter((list) => list.length >= 2)
    .sort((a, b) => (a[0].ponyClubName ?? '').localeCompare(b[0].ponyClubName ?? '', 'en-GB', { sensitivity: 'base' }))
    .map((list) => {
      const clubName = (list[0].ponyClubName ?? '').trim();
      const clubSlug = buildClubSlug(clubName);
      const clubBacsReference = buildClubBacsReference(competitionId, clubName);
      const teamsCount = list.reduce((sum, s) => sum + Math.max(1, s.teamsCount ?? 1), 0);
      const stablesCount = list.reduce((sum, s) => sum + (s.stablesCount ?? 0), 0);
      const totalAmountMinor = list.reduce((sum, s) => sum + s.amountMinor, 0);
      const totalDueMinor = list.filter((s) => s.status === 0).reduce((sum, s) => sum + s.amountMinor, 0);
      const totalPaidMinor = list.filter((s) => s.status === 1).reduce((sum, s) => sum + s.amountMinor, 0);
      return {
        clubName,
        clubSlug,
        clubBacsReference,
        signupsCount: list.length,
        teamsCount,
        stablesCount,
        totalAmountMinor,
        totalDueMinor,
        totalPaidMinor,
        signups: list,
      };
    });
}

/** Returns true when a waitlisted signup has an active 24-hour spot offer that has not yet expired. */
export function hasActiveWaitlistOffer(
  signup: Pick<MySignup | SectionSignup, 'isWaitlist' | 'isWithdrawn' | 'waitlistOfferExpiresAt'>,
  now: Date = new Date(),
): boolean {
  if (!signup.isWaitlist || signup.isWithdrawn || !signup.waitlistOfferExpiresAt) return false;
  const expiresAt = new Date(signup.waitlistOfferExpiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
}

/** Formats a plain-text summary of a combined club invoice for copying or printing. */
export function formatClubInvoiceSummary(competitionName: string, group: ClubInvoiceGroup, paymentDestination?: string | null): string {
  const lines = [
    `Combined Club Invoice — ${competitionName}`,
    `Club: ${group.clubName}`,
    `BACS Reference: ${group.clubBacsReference}`,
    `Teams: ${group.teamsCount} · Stables: ${group.stablesCount}`,
    `Total: ${priceLabel(group.totalAmountMinor)} (Due: ${priceLabel(group.totalDueMinor)} · Paid: ${priceLabel(group.totalPaidMinor)})`,
  ];
  if (paymentDestination?.trim()) {
    lines.push(`Pay to: ${paymentDestination.trim()}`);
  }
  return lines.join('\n');
}
