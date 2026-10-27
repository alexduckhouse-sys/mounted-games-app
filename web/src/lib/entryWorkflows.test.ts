import { describe, expect, it } from 'vitest';
import {
  arrivalManifestCsv,
  arrivalWindowLabel,
  buildClubBacsReference,
  buildClubSlug,
  computeFeeDispositionLedger,
  defaultSelectedReminderIds,
  effectiveFeeDisposition,
  formatClubInvoiceSummary,
  groupArrivalManifest,
  groupClubInvoices,
  hasActiveWaitlistOffer,
  normaliseVehicleReg,
  unpaidReminderCandidates,
} from './entryWorkflows';
import type { SectionSignup } from '../types';

const makeSignup = (id: number, extra: Partial<SectionSignup> = {}): SectionSignup => ({
  id,
  competitionSectionId: 10,
  sectionName: 'Under 12',
  fullName: `Entrant ${id}`,
  amountMinor: 4000,
  status: 0,
  createdAt: '2026-10-01T10:00:00Z',
  ...extra,
});

describe('entryWorkflows', () => {
  it('selects unpaid Pending signups with email addresses for batch reminders', () => {
    const signups = [
      makeSignup(1, { contactEmail: 'trainer@example.org' }),
      makeSignup(2, { contactEmail: null }),
      makeSignup(3, { status: 1, contactEmail: 'paid@example.org' }),
      makeSignup(4, { isWaitlist: true, contactEmail: 'wait@example.org' }),
      makeSignup(5, { isWithdrawn: true, contactEmail: 'out@example.org' }),
      makeSignup(6, { amountMinor: 0, contactEmail: 'free@example.org' }),
    ];
    const candidates = unpaidReminderCandidates(7, signups);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      hasEmail: true,
      defaultSelected: true,
      paymentReference: 'MG-7-1',
    });
    expect(candidates[1]).toMatchObject({
      hasEmail: false,
      defaultSelected: false,
      paymentReference: 'MG-7-2',
    });
    expect(defaultSelectedReminderIds(7, signups)).toEqual([1]);
  });

  it('normalises vehicle registrations and arrival window labels', () => {
    expect(normaliseVehicleReg(' ab12 cde ')).toBe('AB12 CDE');
    expect(normaliseVehicleReg('   ')).toBeNull();
    expect(normaliseVehicleReg(null)).toBeNull();
    expect(arrivalWindowLabel('FridayEvening')).toBe('Friday evening');
    expect(arrivalWindowLabel('SaturdayMorning')).toBe('Saturday morning');
    expect(arrivalWindowLabel('Other')).toBe('Other / not specified');
    expect(arrivalWindowLabel(null)).toBe('Other / not specified');
  });

  it('groups arrival manifest entries and exports CSV for gate stewards', () => {
    const signups = [
      makeSignup(1, { arrivalWindow: 'FridayEvening', vehicleRegistration: 'MG26 BOX', stablesCount: 3, ponyClubName: 'Oak PC', status: 1 }),
      makeSignup(2, { arrivalWindow: 'SaturdayMorning', vehicleRegistration: 'XY99 HBG', stablesCount: 0, teamName: 'Elm A', teamsCount: 2 }),
      makeSignup(3, { arrivalWindow: null, stablesCount: 1, stablingClubOrTeam: '', ponyClubName: null, teamName: null }),
      makeSignup(4, { arrivalWindow: null, stablesCount: 0, vehicleRegistration: '' }),
      makeSignup(5, { arrivalWindow: 'FridayEvening', isWithdrawn: true, stablesCount: 2 }),
    ];
    const grouped = groupArrivalManifest(signups);
    expect(grouped.fridayEvening.map((s) => s.id)).toEqual([1]);
    expect(grouped.saturdayMorning.map((s) => s.id)).toEqual([2]);
    expect(grouped.other.map((s) => s.id)).toEqual([3]);

    const csv = arrivalManifestCsv(signups);
    expect(csv).toContain('Friday evening,MG26 BOX,Oak PC,Entrant 1,Under 12,1,3,Paid');
    expect(csv).toContain('Saturday morning,XY99 HBG,Elm A,Entrant 2,Under 12,2,0,Pending');
    expect(csv).toContain('Other / not specified,,Unaffiliated,Entrant 3,Under 12,1,1,Pending');
  });

  it('computes refund, retained-fee and credit rollover ledger totals accurately', () => {
    expect(effectiveFeeDisposition({ status: 0, refundPending: false, feeDisposition: 'None' })).toBe('None');
    expect(effectiveFeeDisposition({ status: 2, refundPending: false })).toBe('Refunded');
    expect(effectiveFeeDisposition({ status: 3, refundPending: true })).toBe('RefundPending');
    expect(effectiveFeeDisposition({ status: 3, refundPending: true, feeDisposition: 'Retained' })).toBe('Retained');

    const signups = [
      makeSignup(1, { status: 1, amountMinor: 5000 }),
      makeSignup(2, { status: 3, isWithdrawn: true, feeDisposition: 'Retained', amountMinor: 4000 }),
      makeSignup(3, { status: 2, isWithdrawn: true, feeDisposition: 'Refunded', amountMinor: 6000, refundedAmountMinor: 4500 }),
      makeSignup(4, { status: 2, feeDisposition: 'Refunded', amountMinor: 3000 }),
      makeSignup(5, { status: 3, isWithdrawn: true, refundPending: true, amountMinor: 2500 }),
      makeSignup(6, { status: 3, isWithdrawn: true, feeDisposition: 'CreditRollover', amountMinor: 5000 }),
    ];
    const summary = computeFeeDispositionLedger(signups);
    expect(summary.totalRetainedMinor).toBe(5500);
    expect(summary.totalRefundedMinor).toBe(7500);
    expect(summary.refundsPendingMinor).toBe(2500);
    expect(summary.creditsRolledOverMinor).toBe(5000);
    expect(summary.rows).toHaveLength(5);
  });

  it('builds combined club invoices and BACS references for clubs with 2+ signups', () => {
    expect(buildClubSlug('Cheshire Hunt North')).toBe('CHESHIRE-HUNT-NO');
    expect(buildClubSlug('   ')).toBe('CLUB');
    expect(buildClubBacsReference(12, 'Oak Valley PC')).toBe('MGC-12-OAK-VALLEY-PC');

    const signups = [
      makeSignup(1, { ponyClubName: 'Oak Valley PC', amountMinor: 4000, status: 0, teamsCount: 2, stablesCount: 3 }),
      makeSignup(2, { ponyClubName: 'oak valley pc', amountMinor: 2000, status: 1, teamsCount: 1, stablesCount: 1 }),
      makeSignup(3, { ponyClubName: 'Single Club', amountMinor: 4000, status: 0 }),
      makeSignup(4, { ponyClubName: 'Unaffiliated', amountMinor: 4000, status: 0 }),
      makeSignup(5, { ponyClubName: 'Unaffiliated', amountMinor: 4000, status: 0 }),
      makeSignup(6, { ponyClubName: 'Oak Valley PC', amountMinor: 4000, status: 0, isWithdrawn: true }),
    ];
    const groups = groupClubInvoices(12, signups);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      clubName: 'Oak Valley PC',
      clubSlug: 'OAK-VALLEY-PC',
      clubBacsReference: 'MGC-12-OAK-VALLEY-PC',
      signupsCount: 2,
      teamsCount: 3,
      stablesCount: 4,
      totalAmountMinor: 6000,
      totalDueMinor: 4000,
      totalPaidMinor: 2000,
    });

    const text = formatClubInvoiceSummary('Spring Show', groups[0], 'Sort 12-34-56 Acc 12345678');
    expect(text).toContain('Combined Club Invoice — Spring Show');
    expect(text).toContain('BACS Reference: MGC-12-OAK-VALLEY-PC');
    expect(text).toContain('Pay to: Sort 12-34-56 Acc 12345678');
    expect(formatClubInvoiceSummary('Spring Show', groups[0], null)).not.toContain('Pay to:');
  });

  it('detects active vs expired waitlist spot offers', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    expect(hasActiveWaitlistOffer({ isWaitlist: true, isWithdrawn: false, waitlistOfferExpiresAt: '2026-10-27T12:00:00Z' }, now)).toBe(true);
    expect(hasActiveWaitlistOffer({ isWaitlist: true, isWithdrawn: false, waitlistOfferExpiresAt: '2026-10-26T11:59:59Z' }, now)).toBe(false);
    expect(hasActiveWaitlistOffer({ isWaitlist: false, isWithdrawn: false, waitlistOfferExpiresAt: '2026-10-27T12:00:00Z' }, now)).toBe(false);
    expect(hasActiveWaitlistOffer({ isWaitlist: true, isWithdrawn: true, waitlistOfferExpiresAt: '2026-10-27T12:00:00Z' }, now)).toBe(false);
    expect(hasActiveWaitlistOffer({ isWaitlist: true, isWithdrawn: false, waitlistOfferExpiresAt: null }, now)).toBe(false);
  });
});
