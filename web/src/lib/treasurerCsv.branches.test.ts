import { describe, expect, it } from 'vitest';
import { team } from '../test/factories';
import {
  computeTreasurerTotals, matchBankStatementLines, parseBankStatementCsv, treasurerCsv,
  type TreasurerOrderRow, type TreasurerSignupRow,
} from './treasurerCsv';

const signup = (extra: Partial<TreasurerSignupRow> = {}): TreasurerSignupRow => ({
  id: 1, competitionSectionId: 1, sectionName: 'Open', fullName: 'Example Entrant',
  status: 0, amountMinor: 1000, createdAt: '2026-01-01T00:00:00Z', ...extra,
});
const order = (extra: Partial<TreasurerOrderRow> = {}): TreasurerOrderRow => ({
  id: 1, competitionId: 7, status: 0, totalMinor: 1000,
  createdAt: '2026-01-01T00:00:00Z', lines: [], ...extra,
});

describe('treasurer exports with incomplete legacy records', () => {
  it('uses zero for omitted entry amounts and missing order lines or totals', () => {
    // Older cached responses can omit fields that are required by the current DTO.
    const entries = [signup({ amountMinor: undefined, status: 1 })];
    const orders = [order({ status: 2, lines: undefined, totalMinor: undefined })];
    expect(computeTreasurerTotals(entries, orders)).toEqual({
      grossEntriesMinor: 0, grossStablingMinor: 0, grossShopMinor: 0,
      totalRefundsMinor: 0, netTotalCollectedMinor: 0, totalPendingMinor: 0,
    });
    const csv = treasurerCsv({ signups: entries, orders });
    expect(csv).toContain('Section Signup,1,MG-1,Open,Example Entrant,,Individual / pair entry,1,£0.00');
    expect(csv).toContain('Shop Order,1,ORDER-1,Event Shop,,,Order #1,0,£0.00,0,£0.00,0,£0.00,£0.00,Paid,,');
  });

  it('calculates omitted line totals from quantity and price and clamps negative values', () => {
    const orders = [order({ status: 2, lines: [
      { id: 1, title: 'Stable', quantity: 2, unitPriceMinor: 1500, lineTotalMinor: undefined } as unknown as TreasurerOrderRow['lines'][number],
      { id: 2, title: 'Example shirt', quantity: 3, unitPriceMinor: 500, lineTotalMinor: undefined } as unknown as TreasurerOrderRow['lines'][number],
      { id: 3, title: 'Cancelled item', quantity: -1, unitPriceMinor: 500, lineTotalMinor: -500 },
    ] })];
    expect(computeTreasurerTotals([], orders)).toMatchObject({
      grossStablingMinor: 3000, grossShopMinor: 1500, netTotalCollectedMinor: 4500,
    });
    expect(treasurerCsv({ signups: [], orders })).toContain(',5,£0.00,2,£30.00,0,£15.00,£45.00,Paid,,');
  });

  it('exports anonymous refunds using the original paid date when the refund date is absent', () => {
    const csv = treasurerCsv({ signups: [], orders: [order({ status: 5, paidAt: '2026-01-02T12:00:00Z' })] });
    expect(csv).toContain('Refund,1,ORDER-1,Event Shop,,,Order #1 refund,0,£0.00,0,£0.00,0,£10.00,£10.00,Refunded,2026-01-02,Refunded');
  });
});

describe('bank statement validation and matching', () => {
  it.each(['Credit', 'Value', 'Paid in'])('recognises %s headers and excludes balances from the payment amount', heading => {
    const dated = parseBankStatementCsv(`Date,Reference,${heading},Balance\n2026-01-02,MG-1,10.00,999.00\n\n2026-01-03,Not paid,,999.00`);
    expect(dated).toEqual([{
      lineNumber: 2, date: '2026-01-02', reference: 'MG-1', amountMinor: 1000,
      rawText: '2026-01-02,MG-1,10.00,999.00',
    }]);
  });

  it('ignores incomplete and invalid rows rather than inventing a payment', () => {
    expect(parseBankStatementCsv('One cell\nExample,invalid\nExample,0\nExample,-10\nExample,1.234\nExample,\n,10.00')).toEqual([]);
  });

  it('does not match records without a positive outstanding amount', () => {
    const rows = parseBankStatementCsv('MG-1,10.00\nORDER-1,10.00');
    const matches = matchBankStatementLines(rows, [signup({ amountMinor: undefined })], [order({ totalMinor: undefined, status: 1 })]);
    expect(matches.map(row => row.status)).toEqual(['unmatched', 'unmatched']);
  });

  it('matches unnamed test-payment orders by reference without adding an empty buyer label', () => {
    const matches = matchBankStatementLines(parseBankStatementCsv('ORDER-1,10.00'), [], [order({ status: 1 })]);
    expect(matches[0]).toMatchObject({ status: 'matched', matchedLabel: 'Order #1', approved: true });
  });

  it('matches team names and uses the team in the label when an entrant has no custom team name', () => {
    const matches = matchBankStatementLines(parseBankStatementCsv('EXAMPLE TEAM,10.00'), [signup({ teamId: 7 })], [], [team(7, { displayName: 'Example Team' })]);
    expect(matches[0]).toMatchObject({ status: 'matched', matchedLabel: 'Example Entrant (Example Team)', targetId: 1 });
  });

  it('keeps a buyer-name amount mismatch unapproved and permits the later correct payment', () => {
    const matches = matchBankStatementLines(parseBankStatementCsv('EXAMPLE BUYER,5.00\nEXAMPLE BUYER,10.00'), [], [order({ buyerName: 'Example Buyer' })]);
    expect(matches[0]).toMatchObject({ status: 'amount_mismatch', expectedAmountMinor: 1000, approved: false });
    expect(matches[1]).toMatchObject({ status: 'matched', expectedAmountMinor: 1000, approved: true });
  });
});
