import { describe, expect, it } from 'vitest';
import {
  computeTreasurerTotals,
  formatBacsReference,
  formatHookupsCapacityPill,
  formatIsoDateShort,
  formatMoneyPounds,
  formatStablesCapacityPill,
  isHookupItemTitle,
  isStableItemTitle,
  matchBankStatementLines,
  parseBankStatementCsv,
  treasurerCsv,
  type TreasurerOrderRow,
  type TreasurerSignupRow,
} from './treasurerCsv';
import type { Team } from '../types';

const sampleTeams: Team[] = [
  {
    id: 10,
    competitionId: 7,
    competitionSectionId: 1,
    sectionName: 'Open',
    clubId: 2,
    clubName: 'Oakley Hunt West',
    suffix: 'A',
    displayName: 'Oakley Hunt West A',
    isHorsConcours: false,
  },
];

const sampleSignups: TreasurerSignupRow[] = [
  {
    id: 101,
    competitionSectionId: 1,
    sectionName: 'Open',
    fullName: 'Alice Rider',
    ponyClubName: 'Oakley Hunt West',
    teamName: 'Oakley Dragons',
    isWholeTeam: true,
    teamsCount: 2,
    amountMinor: 12000,
    stablesCount: 2,
    hookupsCount: 1,
    status: 1, // Paid
    paidAt: '2026-05-01T14:22:00Z',
    teamId: 10,
    createdAt: '2026-04-28T10:00:00Z',
  },
  {
    id: 102,
    competitionSectionId: 1,
    sectionName: 'Under 17',
    fullName: 'Ben Smith',
    ponyClubName: 'Cheshire PC',
    amountMinor: 4500,
    stablesCount: 1,
    hookupsCount: 0,
    status: 0, // Pending
    paidAt: null,
    teamId: null,
    createdAt: '2026-04-29T10:00:00Z',
  },
  {
    id: 103,
    competitionSectionId: 1,
    sectionName: 'Under 12',
    fullName: 'Clara Davies',
    stablingClubOrTeam: 'Monmouthshire',
    amountMinor: 3500,
    stablesCount: 0,
    status: 2, // Refunded
    paidAt: '2026-04-25T09:00:00Z',
    teamId: null,
    createdAt: '2026-04-24T10:00:00Z',
  },
  {
    id: 104,
    competitionSectionId: 1,
    sectionName: 'Open',
    fullName: 'Dan Evans',
    amountMinor: 5000,
    status: 3, // Cancelled after withdrawal with refund pending
    isWithdrawn: true,
    refundPending: true,
    paidAt: '2026-04-20T09:00:00Z',
    teamId: 10,
    createdAt: '2026-04-19T10:00:00Z',
  },
  {
    id: 105,
    competitionSectionId: 1,
    sectionName: 'Open',
    fullName: 'Waitlist Entry',
    amountMinor: 0,
    status: 0,
    isWaitlist: true,
    createdAt: '2026-04-30T10:00:00Z',
  },
  {
    id: 106,
    competitionSectionId: 1,
    sectionName: 'Open',
    fullName: 'Paid Refund Pending',
    amountMinor: 2000,
    status: 1,
    refundPending: true,
    paidAt: '2026-05-02',
    createdAt: '2026-04-30T11:00:00Z',
  },
];

const sampleOrders: TreasurerOrderRow[] = [
  {
    id: 501,
    competitionId: 7,
    buyerUserId: 'u1',
    buyerName: 'Sarah Buyer',
    status: 2, // Paid
    totalMinor: 9500,
    paidAt: '2026-05-01T15:00:00Z',
    createdAt: '2026-05-01T14:00:00Z',
    lines: [
      {
        id: 1,
        title: 'Weekend stabling',
        unitPriceMinor: 3000,
        quantity: 2,
        lineTotalMinor: 6000,
        detail: 'Box 12',
      },
      {
        id: 2,
        title: 'Electric hook-up',
        unitPriceMinor: 2000,
        quantity: 1,
        lineTotalMinor: 2000,
      },
      {
        id: 3,
        title: 'Shavings bale',
        unitPriceMinor: 1500,
        quantity: 1,
        lineTotalMinor: 1500,
      },
    ],
  },
  {
    id: 502,
    competitionId: 7,
    buyerUserId: 'u2',
    buyerName: 'Tom Unpaid',
    status: 0, // AwaitingManualPayment
    totalMinor: 3000,
    paidAt: null,
    createdAt: '2026-05-02T10:00:00Z',
    lines: [
      {
        id: 4,
        title: 'Event hoodie',
        unitPriceMinor: 3000,
        quantity: 1,
        lineTotalMinor: 3000,
      },
    ],
  },
  {
    id: 503,
    competitionId: 7,
    buyerUserId: 'u3',
    status: 5, // Refunded
    totalMinor: 2500,
    paidAt: '2026-04-28T10:00:00Z',
    refundedAt: '2026-04-29T10:00:00Z',
    createdAt: '2026-04-28T09:00:00Z',
    lines: [],
  },
];

describe('treasurerCsv & capacity helpers', () => {
  it('classifies stabling and electric hook-up titles accurately', () => {
    expect(isStableItemTitle(null)).toBe(false);
    expect(isStableItemTitle('Weekend stabling')).toBe(true);
    expect(isStableItemTitle('Day Stable')).toBe(true);
    expect(isStableItemTitle('Stable shavings bale')).toBe(false);
    expect(isStableItemTitle('Stable haylage')).toBe(false);
    expect(isStableItemTitle('Stable bedding')).toBe(false);
    expect(isStableItemTitle('Programme')).toBe(false);

    expect(isHookupItemTitle(undefined)).toBe(false);
    expect(isHookupItemTitle('Electric hook-up')).toBe(true);
    expect(isHookupItemTitle('Horsebox pitch with hook up')).toBe(true);
    expect(isHookupItemTitle('Lorry hookup')).toBe(true);
    expect(isHookupItemTitle('Weekend stabling')).toBe(false);
  });

  it('formats live venue capacity pills for stables and hook-ups', () => {
    expect(formatStablesCapacityPill(null, 10)).toBeNull();
    expect(formatStablesCapacityPill(0, 0)).toBeNull();
    expect(formatStablesCapacityPill(80, null)).toBeNull();
    expect(formatStablesCapacityPill(80, 14)).toBe('14 of 80 stables left');
    expect(formatStablesCapacityPill(1, 1)).toBe('1 of 1 stable left');
    expect(formatStablesCapacityPill(80, 0)).toBe('All stables are booked');

    expect(formatHookupsCapacityPill(null, 5)).toBeNull();
    expect(formatHookupsCapacityPill(20, null)).toBeNull();
    expect(formatHookupsCapacityPill(20, 8)).toBe('8 of 20 hook-ups left');
    expect(formatHookupsCapacityPill(1, 1)).toBe('1 of 1 hook-up left');
    expect(formatHookupsCapacityPill(20, 0)).toBe('All electric hook-ups are booked');
  });

  it('formats currency, short dates, and BACS references', () => {
    expect(formatMoneyPounds(4500)).toBe('£45.00');
    expect(formatMoneyPounds(-1250)).toBe('-£12.50');
    expect(formatIsoDateShort(null)).toBe('');
    expect(formatIsoDateShort('2026-05-01')).toBe('2026-05-01');
    expect(formatIsoDateShort('2026-05-01T12:00:00Z')).toBe('2026-05-01');
    expect(formatIsoDateShort('May 1')).toBe('May 1');
    expect(formatBacsReference(42)).toBe('MG-42');
    expect(formatBacsReference(42, 7)).toBe('MG-7-42');
  });

  it('computes unified treasurer financial totals and exports audit-ready CSV', () => {
    const totals = computeTreasurerTotals(sampleSignups, sampleOrders, 2500);
    // Paid entries: 101 (£120 + £50 stables), 106 (£20, refundPending), Refunded: 103 (£35)
    expect(totals.grossEntriesMinor).toBe(12000 + 2000 + 3500);
    // Stabling: 101 (2 * 2500 = 5000) + order 501 (6000 stabling + 2000 hookup = 8000) = 13000
    expect(totals.grossStablingMinor).toBe(13000);
    // Shop (non-stabling): order 501 shavings (1500) + order 503 refunded (2500) = 4000
    expect(totals.grossShopMinor).toBe(4000);
    // Refunds: 103 (3500) + 104 (5000) + 106 (2000) + order 503 (2500) = 13000
    expect(totals.totalRefundsMinor).toBe(13000);
    // Net collected: 101 (17000) + order 501 (9500) = 26500
    expect(totals.netTotalCollectedMinor).toBe(26500);
    // Pending: 102 (4500 + 2500 = 7000) + order 502 (3000) = 10000
    expect(totals.totalPendingMinor).toBe(10000);

    const csv = treasurerCsv({
      competitionId: 7,
      competitionName: 'Spring Championships',
      signups: sampleSignups,
      orders: sampleOrders,
      teams: sampleTeams,
      stablingUnitPriceMinor: 2500,
    });
    expect(csv.startsWith('Record Type,ID,BACS Reference')).toBe(true);
    expect(csv).toContain('Section Signup,101,MG-7-101,Open,Alice Rider,Oakley Dragons,Whole team entry (2),2,£120.00,2,£50.00,1,£0.00,£170.00,Paid,2026-05-01,');
    expect(csv).toContain('Refund,103,MG-7-103,Under 12,Clara Davies,Monmouthshire,Entry refund completed,1,£35.00,0,£0.00,0,£0.00,£35.00,Refunded,2026-04-25,Refunded');
    expect(csv).toContain('Refund,104,MG-7-104,Open,Dan Evans,Oakley Hunt West A,Entry withdrawal — refund pending,1,£50.00,0,£0.00,0,£0.00,£50.00,RefundPending,2026-04-20,RefundPending');
    expect(csv).toContain('Shop Order,501,ORDER-501,Event Shop,Sarah Buyer,,Weekend stabling x2 (Box 12); Electric hook-up x1; Shavings bale x1,4,£0.00,2,£80.00,1,£15.00,£95.00,Paid,2026-05-01,');
    expect(csv).toContain('Refund,503,ORDER-503,Event Shop,u3,,Order #503 refund,0,£0.00,0,£0.00,0,£25.00,£25.00,Refunded,2026-04-29,Refunded');
    expect(csv).toContain('SUMMARY TOTALS,,,,,,Gross Entries: £175.00 | Gross Stabling: £130.00 | Gross Shop: £40.00 | Total Refunds: £130.00 | Net Collected: £265.00 | Total Pending: £100.00,,£175.00,,£130.00,,£40.00,£265.00,Pending: £100.00,,Refunds: £130.00');
  });

  it('handles pure stabling shop orders and default parameters in treasurerCsv', () => {
    const stablingOnlyOrder: TreasurerOrderRow = {
      id: 600,
      competitionId: 7,
      status: 99, // unknown status fallback
      totalMinor: 3000,
      createdAt: '2026-05-03T10:00:00Z',
      lines: [
        {
          id: 10,
          title: 'Weekend stabling',
          unitPriceMinor: 3000,
          quantity: 1,
          lineTotalMinor: 3000,
        },
      ],
    };
    const csv = treasurerCsv({
      signups: [
        {
          id: 1,
          competitionSectionId: 1,
          sectionName: 'Open',
          fullName: 'Solo',
          amountMinor: 1000,
          status: 99 as never,
          createdAt: '2026-05-01T00:00:00Z',
        },
      ],
      orders: [stablingOnlyOrder],
    });
    expect(csv).toContain('Shop Order,600,ORDER-600,Stabling & Hook-up,,,Weekend stabling x1,1,£0.00,1,£30.00,0,£0.00,£30.00,Pending,,');
  });

  it('parses bank statement CSV and matches BACS references, names, amount mismatches, and unmatched lines', () => {
    expect(parseBankStatementCsv('   ')).toEqual([]);

    const csvText = [
      'Date,Description,Amount',
      '2026-05-03,"FPS CREDIT ""MG-7-102"" BEN",45.00',
      '2026-05-03,MG-102 PARTIAL PAYMENT,20.00',
      '2026-05-04,ORDER-502 TOM UNPAID,£30.00',
      '2026-05-04,ORDER-502 WRONG AMOUNT,£15.00',
      '2026-05-05\tCHESHIRE PC BACS\t45.00',
      'TOM UNPAID HOODIE,30.00',
      '2026-05-06,UNKNOWN SENDER XYZ,99.99',
      '2026-05-06,DEBIT CARD COFFEE,-4.50',
    ].join('\r\n');

    const parsed = parseBankStatementCsv(csvText);
    expect(parsed).toHaveLength(7);
    expect(parsed[0]).toMatchObject({
      date: '2026-05-03',
      reference: 'FPS CREDIT "MG-7-102" BEN',
      amountMinor: 4500,
    });

    const pendingSignups: TreasurerSignupRow[] = [
      {
        id: 102,
        competitionSectionId: 1,
        sectionName: 'Under 17',
        fullName: 'Ben Smith',
        ponyClubName: 'Cheshire PC',
        amountMinor: 4500,
        status: 0,
        createdAt: '2026-04-29T10:00:00Z',
      },
      {
        id: 108,
        competitionSectionId: 1,
        sectionName: 'Under 14',
        fullName: 'Lucy Jones',
        ponyClubName: 'Cheshire PC',
        amountMinor: 4500,
        status: 0,
        createdAt: '2026-04-29T11:00:00Z',
      },
      {
        id: 109,
        competitionSectionId: 1,
        sectionName: 'Individuals',
        fullName: 'No Club Rider',
        amountMinor: 2500,
        status: 0,
        createdAt: '2026-04-29T12:00:00Z',
      },
    ];

    const pendingOrders: TreasurerOrderRow[] = [
      sampleOrders[1], // id 502, Tom Unpaid, 3000
      {
        id: 509,
        competitionId: 7,
        buyerName: 'Tom Unpaid',
        status: 0,
        totalMinor: 3000,
        createdAt: '2026-05-02T11:00:00Z',
        lines: [],
      },
    ];

    const matches = matchBankStatementLines(parsed, pendingSignups, pendingOrders, sampleTeams);
    expect(matches[0]).toMatchObject({
      status: 'matched',
      targetKind: 'signup',
      targetId: 102,
      matchedLabel: 'Ben Smith (Cheshire PC)',
      approved: true,
    });
    // 102 was already claimed by exact match in line 0, so MG-102 on line 1 falls through to unmatched
    expect(matches[1].status).toBe('unmatched');
    expect(matches[2]).toMatchObject({
      status: 'matched',
      targetKind: 'order',
      targetId: 502,
      matchedLabel: 'Order #502 · Tom Unpaid',
      approved: true,
    });
    expect(matches[3].status).toBe('unmatched');
    // Line 4 matches signup 108 by Pony Club name "Cheshire PC" + exact amount 4500
    expect(matches[4]).toMatchObject({
      status: 'matched',
      targetKind: 'signup',
      targetId: 108,
      matchedLabel: 'Lucy Jones (Cheshire PC)',
      approved: true,
    });
    // Line 5 matches order 509 by buyerName "Tom Unpaid" + exact amount 3000
    expect(matches[5]).toMatchObject({
      status: 'matched',
      targetKind: 'order',
      targetId: 509,
      matchedLabel: 'Order #509 · Tom Unpaid',
      approved: true,
    });
    // Line 6 is unmatched
    expect(matches[6]).toMatchObject({
      status: 'unmatched',
      targetKind: null,
      targetId: null,
      approved: false,
    });

    // Also verify amount_mismatch on MG-reference and ORDER-reference and No Club Rider name match
    const mismatchLines = parseBankStatementCsv(
      [
        '2026-05-07,MG-109 PARTIAL,10.00',
        '2026-05-07,ORDER-502 PARTIAL,12.00',
        '2026-05-07,NO CLUB RIDER,10.00',
      ].join('\n'),
    );
    const mismatchResults = matchBankStatementLines(mismatchLines, pendingSignups, pendingOrders);
    expect(mismatchResults[0]).toMatchObject({
      status: 'amount_mismatch',
      targetKind: 'signup',
      targetId: 109,
      matchedLabel: 'No Club Rider',
      expectedAmountMinor: 2500,
      approved: false,
    });
    expect(mismatchResults[1]).toMatchObject({
      status: 'amount_mismatch',
      targetKind: 'order',
      targetId: 502,
      expectedAmountMinor: 3000,
      approved: false,
    });
    expect(mismatchResults[2]).toMatchObject({
      status: 'amount_mismatch',
      targetKind: 'signup',
      targetId: 109,
      approved: false,
    });
  });
});
