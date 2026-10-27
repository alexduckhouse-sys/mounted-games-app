import { describe, expect, it } from 'vitest';
import type { SectionSignup } from '../types';
import {
  arrivalManifestCsv,
  buildClubSlug,
  computeFeeDispositionLedger,
  effectiveFeeDisposition,
  formatClubInvoiceSummary,
  groupArrivalManifest,
  groupClubInvoices,
  hasActiveWaitlistOffer,
} from './entryWorkflows';

const signup = (id: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    competitionSectionId: 10,
    sectionName: 'Under 12',
    fullName: `Entrant ${id}`,
    amountMinor: 4000,
    status: 0,
    createdAt: '2026-10-01T10:00:00Z',
    ...extra,
  }) as unknown as SectionSignup;

describe('groupArrivalManifest', () => {
  it('skips inactive signups and ones with nothing to manifest, then groups by window', () => {
    const grouped = groupArrivalManifest([
      signup(1, { isWithdrawn: true, stablesCount: 1 }),
      signup(2, { isWaitlist: true, stablesCount: 1 }),
      signup(3, { status: 2, stablesCount: 1 }),
      signup(4, { status: 3, stablesCount: 1 }),
      signup(5, {}),
      signup(6, { vehicleRegistration: '   ' }),
      signup(7, { arrivalWindow: 'FridayEvening' }),
      signup(8, { arrivalWindow: 'SaturdayMorning' }),
      signup(9, { stablesCount: 2 }),
      signup(10, { vehicleRegistration: 'AB12 CDE' }),
    ]);
    expect(grouped.fridayEvening.map((s) => s.id)).toEqual([7]);
    expect(grouped.saturdayMorning.map((s) => s.id)).toEqual([8]);
    expect(grouped.other.map((s) => s.id)).toEqual([9, 10]);
  });
});

describe('arrivalManifestCsv fallbacks', () => {
  it('chooses a club label and defaults teams, stables and status', () => {
    const csv = arrivalManifestCsv([
      signup(1, { arrivalWindow: 'FridayEvening', stablingClubOrTeam: ' Stable Club ', ponyClubName: 'PC', teamName: 'T', status: 1, teamsCount: 3, stablesCount: 2, vehicleRegistration: ' x1 ' }),
      signup(2, { arrivalWindow: 'FridayEvening', ponyClubName: 'Pony Club' }),
      signup(3, { arrivalWindow: 'FridayEvening', teamName: 'Team Name', teamsCount: 0 }),
      signup(4, { arrivalWindow: 'SaturdayMorning' }),
    ]);
    const lines = csv.split(/\r?\n/);
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('x1,Stable Club,Entrant 1');
    expect(lines[1]).toContain(',3,2,Paid');
    expect(lines[2]).toContain(',Pony Club,');
    expect(lines[3]).toContain(',Team Name,');
    expect(lines[3]).toContain(',1,0,Pending');
    expect(lines[4]).toContain(',Unaffiliated,');
  });
});

describe('fee disposition', () => {
  it('prefers an explicit disposition, then falls back to status and refund flags', () => {
    expect(effectiveFeeDisposition({ status: 0, refundPending: false, feeDisposition: 'Retained' })).toBe('Retained');
    expect(effectiveFeeDisposition({ status: 2, refundPending: false, feeDisposition: 'None' })).toBe('Refunded');
    expect(effectiveFeeDisposition({ status: 1, refundPending: true, feeDisposition: undefined })).toBe('RefundPending');
    expect(effectiveFeeDisposition({ status: 1, refundPending: false, feeDisposition: undefined })).toBe('None');
  });

  it('totals the ledger across every disposition and clamps partial refunds', () => {
    const ledger = computeFeeDispositionLedger([
      signup(1, { feeDisposition: 'Retained', amountMinor: 1000 }),
      signup(2, { status: 2, amountMinor: 2000 }), // full refund by default
      signup(3, { feeDisposition: 'Refunded', amountMinor: 3000, refundedAmountMinor: 1000 }), // 2000 retained
      signup(4, { feeDisposition: 'Refunded', amountMinor: 500, refundedAmountMinor: 9999 }), // clamped to amount
      signup(5, { feeDisposition: 'Refunded', amountMinor: 500, refundedAmountMinor: -5 }), // clamped to zero
      signup(6, { refundPending: true, amountMinor: 700 }),
      signup(7, { feeDisposition: 'CreditRollover', amountMinor: 800 }),
      signup(8, { isWithdrawn: true, amountMinor: 900 }), // ledger row but no money moves
      signup(9, { status: 3, amountMinor: 100 }),
      signup(10, { status: 1, amountMinor: 5000 }), // not a ledger row
    ]);
    expect(ledger).toMatchObject({
      totalRetainedMinor: 1000 + 2000 + 500,
      totalRefundedMinor: 2000 + 1000 + 500 + 0,
      refundsPendingMinor: 700,
      creditsRolledOverMinor: 800,
    });
    expect(ledger.rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ledger.rows[1].feeDisposition).toBe('Refunded');
  });
});

describe('club invoices', () => {
  it('builds slugs with fallbacks and truncation', () => {
    expect(buildClubSlug(null)).toBe('CLUB');
    expect(buildClubSlug(undefined)).toBe('CLUB');
    expect(buildClubSlug('  !!! ')).toBe('CLUB');
    expect(buildClubSlug('Oakley Hunt & West Pony Club')).toBe('OAKLEY-HUNT-WEST');
    expect(buildClubSlug('Abcdefghijklmno pq')).toBe('ABCDEFGHIJKLMNO');
  });

  it('groups clubs with two or more live signups and sums their money', () => {
    const groups = groupClubInvoices(5, [
      signup(1, { ponyClubName: 'Zeta PC', amountMinor: 1000, status: 0, teamsCount: 2, stablesCount: 1 }),
      signup(2, { ponyClubName: ' zeta pc ', amountMinor: 2000, status: 1 }),
      signup(3, { ponyClubName: 'Alpha PC', amountMinor: 500 }),
      signup(4, { ponyClubName: 'alpha pc', amountMinor: 500, status: 1, teamsCount: 0 }),
      signup(5, { ponyClubName: 'Solo PC' }),
      signup(6, { ponyClubName: 'Unaffiliated' }),
      signup(7, { ponyClubName: 'unaffiliated' }),
      signup(8, { ponyClubName: '' }),
      signup(9, { ponyClubName: null }),
      signup(10, { ponyClubName: 'Zeta PC', isWithdrawn: true }),
      signup(11, { ponyClubName: 'Zeta PC', isWaitlist: true }),
      signup(12, { ponyClubName: 'Zeta PC', status: 2 }),
      signup(13, { ponyClubName: 'Solo PC', status: 3 }),
    ]);
    expect(groups.map((g) => g.clubName)).toEqual(['Alpha PC', 'Zeta PC']);
    expect(groups[1]).toMatchObject({
      clubSlug: 'ZETA-PC',
      clubBacsReference: 'MGC-5-ZETA-PC',
      signupsCount: 2,
      teamsCount: 3,
      stablesCount: 1,
      totalAmountMinor: 3000,
      totalDueMinor: 1000,
      totalPaidMinor: 2000,
    });
    expect(groups[0]).toMatchObject({ teamsCount: 2, stablesCount: 0 });
  });

  it('formats a summary with or without payment details', () => {
    const [group] = groupClubInvoices(5, [signup(1, { ponyClubName: 'Zeta PC' }), signup(2, { ponyClubName: 'Zeta PC' })]);
    const base = formatClubInvoiceSummary('Cup', group);
    expect(base).toContain('Combined Club Invoice — Cup');
    expect(base).not.toContain('Pay to');
    expect(formatClubInvoiceSummary('Cup', group, '   ')).toBe(base);
    expect(formatClubInvoiceSummary('Cup', group, ' Sort 00-00-00 ')).toContain('\nPay to: Sort 00-00-00');
  });
});

describe('hasActiveWaitlistOffer', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  it('requires a waitlisted, live signup with an unexpired offer', () => {
    expect(hasActiveWaitlistOffer({ isWaitlist: false, waitlistOfferExpiresAt: '2026-10-02T00:00:00Z' }, now)).toBe(false);
    expect(hasActiveWaitlistOffer({ isWaitlist: true, isWithdrawn: true, waitlistOfferExpiresAt: '2026-10-02T00:00:00Z' }, now)).toBe(false);
    expect(hasActiveWaitlistOffer({ isWaitlist: true, waitlistOfferExpiresAt: null }, now)).toBe(false);
    expect(hasActiveWaitlistOffer({ isWaitlist: true, waitlistOfferExpiresAt: 'garbage' }, now)).toBe(false);
    expect(hasActiveWaitlistOffer({ isWaitlist: true, waitlistOfferExpiresAt: '2026-10-01T11:00:00Z' }, now)).toBe(false);
    expect(hasActiveWaitlistOffer({ isWaitlist: true, waitlistOfferExpiresAt: '2026-10-01T13:00:00Z' }, now)).toBe(true);
  });

  it('defaults to the current time', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(hasActiveWaitlistOffer({ isWaitlist: true, waitlistOfferExpiresAt: future })).toBe(true);
  });
});
