import { describe, expect, it } from 'vitest';
import {
  computeTreasurerTotals,
  formatHookupsCapacityPill,
  formatStablesCapacityPill,
  isHookupItemTitle,
  isStableItemTitle,
  matchBankStatementLines,
  parseBankStatementCsv,
  treasurerCsv,
  type BankStatementLine,
  type TreasurerOrderRow,
  type TreasurerSignupRow,
} from './treasurerCsv';
import type { Team } from '../types';

const signup = (id: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    competitionSectionId: 1,
    sectionName: 'Open',
    fullName: `Rider ${id}`,
    amountMinor: 1000,
    status: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...extra,
  }) as unknown as TreasurerSignupRow;

const order = (id: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    competitionId: 1,
    status: 2,
    totalMinor: 2000,
    createdAt: '2026-01-01T00:00:00Z',
    lines: [],
    ...extra,
  }) as unknown as TreasurerOrderRow;

const line = (title: string, extra: Record<string, unknown> = {}) => ({
  id: 1,
  title,
  unitPriceMinor: 500,
  quantity: 2,
  lineTotalMinor: 1000,
  ...extra,
});

const team = (id: number, displayName: string) => ({ id, displayName }) as unknown as Team;

describe('title and capacity helpers', () => {
  it('rejects stable-adjacent products and empty titles', () => {
    expect(isStableItemTitle(null)).toBe(false);
    expect(isStableItemTitle('Horse feed')).toBe(false);
    expect(isStableItemTitle('Stable shavings')).toBe(false);
    expect(isStableItemTitle('Stabling bedding bale')).toBe(false);
    expect(isStableItemTitle('Stabling')).toBe(true);
    expect(isHookupItemTitle(undefined)).toBe(false);
    expect(isHookupItemTitle('Hook up')).toBe(true);
    expect(isHookupItemTitle('Hookup')).toBe(true);
    expect(isHookupItemTitle('Electric point')).toBe(true);
    expect(isHookupItemTitle('Tee shirt')).toBe(false);
  });

  it('formats capacity pills for singular, plural, sold-out and unknown', () => {
    expect(formatStablesCapacityPill(null, 3)).toBeNull();
    expect(formatStablesCapacityPill(0, 3)).toBeNull();
    expect(formatStablesCapacityPill(5, null)).toBeNull();
    expect(formatStablesCapacityPill(5, -2)).toBe('All stables are booked');
    expect(formatStablesCapacityPill(1, 1)).toBe('1 of 1 stable left');
    expect(formatStablesCapacityPill(4, 2)).toBe('2 of 4 stables left');
    expect(formatHookupsCapacityPill(undefined, 3)).toBeNull();
    expect(formatHookupsCapacityPill(5, undefined)).toBeNull();
    expect(formatHookupsCapacityPill(5, 0)).toBe('All electric hook-ups are booked');
    expect(formatHookupsCapacityPill(1, 1)).toBe('1 of 1 hook-up left');
    expect(formatHookupsCapacityPill(3, 2)).toBe('2 of 3 hook-ups left');
  });
});

describe('computeTreasurerTotals edge cases', () => {
  it('treats missing amounts as zero and splits each signup status', () => {
    const totals = computeTreasurerTotals(
      [
        signup(1, { status: 1, amountMinor: undefined, stablesCount: undefined }),
        signup(2, { status: 1, refundPending: true, stablesCount: 1 }),
        signup(3, { status: 2 }),
        signup(4, { status: 0, isWaitlist: true }),
        signup(5, { status: 0, isWithdrawn: true }),
        signup(6, { status: 3, refundPending: true }),
        signup(7, { status: 3 }),
        signup(8, { status: 0, amountMinor: -5 }),
      ],
      [],
      300,
    );
    expect(totals).toEqual({
      grossEntriesMinor: 2000,
      grossStablingMinor: 300,
      grossShopMinor: 0,
      totalRefundsMinor: 1000 + 300 + 1000 + 1000,
      netTotalCollectedMinor: 0,
      totalPendingMinor: 0,
    });
  });

  it('derives order totals from lines or the order total, per status', () => {
    const totals = computeTreasurerTotals(
      [],
      [
        order(1, { status: 2, lines: [line('Stable'), line('Tee', { lineTotalMinor: undefined })] }),
        order(2, { status: 5, lines: [], totalMinor: 700 }),
        order(3, { status: 1, lines: undefined, totalMinor: undefined }),
        order(4, { status: 0, lines: [line('Cap', { lineTotalMinor: -50 })], totalMinor: 5 }),
        order(5, { status: 3, lines: [], totalMinor: 900 }),
        order(6, { status: 2, lines: [], totalMinor: 400 }),
      ],
    );
    expect(totals.grossStablingMinor).toBe(1000);
    expect(totals.grossShopMinor).toBe(1000 + 700 + 400);
    expect(totals.netTotalCollectedMinor).toBe(2000 + 400);
    expect(totals.totalRefundsMinor).toBe(700);
    expect(totals.totalPendingMinor).toBe(0);
  });
});

describe('treasurerCsv row branches', () => {
  it('chooses a club name from team, pony club or stabling fallback', () => {
    const csv = treasurerCsv({
      signups: [
        signup(1, { teamName: ' Named ', teamId: 5 }),
        signup(2, { teamId: 5 }),
        signup(3, { teamId: 99, ponyClubName: ' Pony ' }),
        signup(4, { stablingClubOrTeam: 'Stabler' }),
        signup(5, {}),
      ],
      teams: [team(5, 'Display Team')],
    });
    expect(csv).toContain(',Named,');
    expect(csv).toContain(',Display Team,');
    expect(csv).toContain(',Pony,');
    expect(csv).toContain(',Stabler,');
    expect(csv).toContain('MG-1,');
    expect(csv).not.toContain('MG-undefined');
  });

  it('labels withdrawn, waitlist, unknown status, refunds and whole-team entries', () => {
    const csv = treasurerCsv({
      competitionId: 9,
      signups: [
        signup(1, { isWithdrawn: true, refundPending: true, isWholeTeam: true, teamsCount: 0 }),
        signup(2, { isWaitlist: true }),
        signup(3, { status: 9 }),
        signup(4, { status: 2, teamsCount: 3, isWholeTeam: true }),
        signup(5, { status: 1, hookupsCount: 2, stablesCount: 1 }),
      ],
      stablingUnitPriceMinor: 250,
    });
    const lines = csv.split(/\r?\n/);
    expect(csv).toContain('MG-9-1');
    expect(csv).toContain('Withdrawn');
    expect(csv).toContain('Waitlist');
    expect(csv).toContain('Whole team entry (1)');
    expect(csv).toContain('Whole team entry (3)');
    expect(csv).toContain('Entry withdrawal — refund pending');
    expect(csv).toContain('Entry refund completed');
    expect(lines.some((l) => l.includes(',3,') && l.includes('Pending'))).toBe(true);
    expect(csv).toContain('Refunds: £10.00');
  });

  it('writes shop order rows, a refund row, and falls back for buyer and summary', () => {
    const csv = treasurerCsv({
      signups: [],
      orders: [
        order(2, {
          buyerUserId: 'user-7',
          status: 5,
          refundedAt: null,
          paidAt: '2026-02-03T10:00:00Z',
          lines: [line('Stable', { detail: 'Box 4' }), line('Electric hookup')],
        }),
        order(1, { buyerName: 'Bea', status: 5, refundedAt: '2026-03-01T00:00:00Z', lines: [line('Tee')] }),
        order(3, { status: 9, totalMinor: undefined, lines: undefined }),
        order(4, { buyerName: 'Cy', lines: [line('Stabling', { lineTotalMinor: undefined })] }),
      ],
    });
    expect(csv).toContain('ORDER-1');
    expect(csv).toContain('Stable x2 (Box 4); Electric hookup x2');
    expect(csv).toContain('Order #3');
    expect(csv).toContain('user-7');
    expect(csv).toContain('Bea');
    expect(csv).toContain('2026-03-01');
    expect(csv).toContain('2026-02-03');
    expect(csv).toContain('Stabling & Hook-up');
    expect(csv).toContain('Event Shop');
    expect(csv).toContain('Order #1 refund');
    expect(csv).toContain('Pending');
  });
});

describe('parseBankStatementCsv branches', () => {
  it('handles empty input, tab separation, quotes, balance columns and short rows', () => {
    expect(parseBankStatementCsv('')).toEqual([]);
    expect(parseBankStatementCsv('   \n ')).toEqual([]);

    const text = [
      'Date,Description,Amount,Balance',
      '01/05/2026,"MG-1-5, with ""quote""",£45.00,£1000.00',
      '',
      '02/05/2026\tTab ref\t12.50',
      'Only ref,30',
      'Bad,notanumber',
      'one cell',
      '03/05/2026,Nothing numeric,abc',
      '04/05/2026,,10.00',
    ].join('\r\n');
    const lines = parseBankStatementCsv(text);
    expect(lines.map((l) => [l.date, l.reference, l.amountMinor])).toEqual([
      ['01/05/2026', 'MG-1-5, with "quote"', 4500],
      ['02/05/2026', 'Tab ref', 1250],
      ['', 'Only ref', 3000],
    ]);
    expect(lines[2].lineNumber).toBe(5);
    expect(lines).toHaveLength(3);
  });

  it('treats a first line that is not a header as data', () => {
    const lines = parseBankStatementCsv('Date,Ref,10.00\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ date: 'Date', reference: 'Ref', amountMinor: 1000 });
  });

  it('rejects zero, negative and malformed amounts', () => {
    expect(parseBankStatementCsv('a,b,0.00\na,b,-5.00\na,b,1.234')).toEqual([]);
  });
});

describe('matchBankStatementLines branches', () => {
  const bank = (reference: string, amountMinor: number, lineNumber = 1): BankStatementLine => ({
    lineNumber,
    date: 'd',
    reference,
    amountMinor,
    rawText: reference,
  });

  it('matches explicit references, flags mismatches and reuses nothing twice', () => {
    const rows = matchBankStatementLines(
      [
        bank('MG-1-11', 1000, 1),
        bank('MG-1-11', 1000, 2), // already used, falls through
        bank('ENTRY 12', 999, 3), // mismatch keeps id free
        bank('SIGNUP-12', 1000, 4),
        bank('ORDER #21', 2000, 5),
        bank('ORDER-21', 2000, 6),
        bank('ORDER-22', 1, 7),
        bank('ORDER-22', 5000, 8),
      ],
      [signup(11, { fullName: 'Zed Qq' }), signup(12, { fullName: 'Yan Ww' })],
      [order(21, { status: 1, buyerName: 'Bob Bb' }), order(22, { status: 0, totalMinor: 5000, buyerName: null })],
    );
    expect(rows.map((r) => r.status)).toEqual([
      'matched',
      'unmatched',
      'amount_mismatch',
      'matched',
      'matched',
      'unmatched',
      'amount_mismatch',
      'matched',
    ]);
    expect(rows[0]).toMatchObject({ targetKind: 'signup', targetId: 11, approved: true, matchedLabel: 'Zed Qq' });
    expect(rows[2]).toMatchObject({ approved: false, expectedAmountMinor: 1000 });
    expect(rows[4].matchedLabel).toBe('Order #21 · Bob Bb');
    expect(rows[7].matchedLabel).toBe('Order #22');
  });

  it('matches by names, preferring an exact amount, and labels with team or club', () => {
    const rows = matchBankStatementLines(
      [
        bank('payment from alice archer', 700, 1),
        bank('alice archer', 900, 2),
        bank('thanks to Display Team', 1000, 3),
        bank('Pony Club subs', 1000, 4),
        bank('Fiona Foo', 500, 5),
        bank('xx', 500, 6),
        bank('carol cat', 400, 7),
        bank('carol cat', 400, 8),
      ],
      [
        signup(1, { fullName: 'Alice Archer', amountMinor: 900 }),
        signup(2, { fullName: 'Alice Archer', amountMinor: 700, teamName: 'Dragons' }),
        signup(3, { fullName: 'Tim', teamId: 8, amountMinor: 1000 }),
        signup(4, { fullName: 'Pat', ponyClubName: 'Pony Club', amountMinor: 1000 }),
        signup(5, { fullName: 'Fiona Foo', amountMinor: 0 }),
        signup(6, { fullName: 'Waitlisted Wendy', isWaitlist: true }),
        signup(7, { fullName: 'Paid Pam', status: 1 }),
      ],
      [order(30, { status: 0, buyerName: 'Carol Cat', totalMinor: 400 }), order(31, { status: 1, buyerName: 'Carol Cat', totalMinor: 123 })],
      [team(8, 'Display Team')],
    );
    expect(rows[0]).toMatchObject({ targetId: 2, status: 'matched', matchedLabel: 'Alice Archer (Dragons)' });
    expect(rows[1]).toMatchObject({ targetId: 1, status: 'matched', matchedLabel: 'Alice Archer' });
    expect(rows[2]).toMatchObject({ targetId: 3, matchedLabel: 'Tim (Display Team)' });
    expect(rows[3]).toMatchObject({ targetId: 4, matchedLabel: 'Pat (Pony Club)' });
    expect(rows[4].status).toBe('unmatched'); // zero-amount signups are not pending payments
    expect(rows[5].status).toBe('unmatched');
    expect(rows[6]).toMatchObject({ targetKind: 'order', targetId: 30, status: 'matched' });
    expect(rows[7]).toMatchObject({ targetKind: 'order', targetId: 31, status: 'amount_mismatch', approved: false });
  });

  it('uses defaults when orders and teams are omitted', () => {
    const rows = matchBankStatementLines([bank('nothing here', 100)], [signup(1)]);
    expect(rows[0]).toMatchObject({ status: 'unmatched', targetId: null, matchedLabel: null, expectedAmountMinor: null });
  });
});

describe('computeTreasurerTotals partial refunds', () => {
  it('keeps the unrefunded part of a refunded entry as collected', () => {
    const totals = computeTreasurerTotals([
      signup(1, { status: 2, amountMinor: 1200, refundedAmountMinor: 900 }),
      signup(2, { status: 2, amountMinor: 1000 }),
    ]);
    expect(totals.totalRefundsMinor).toBe(900 + 1000);
    expect(totals.netTotalCollectedMinor).toBe(300);
  });
});
