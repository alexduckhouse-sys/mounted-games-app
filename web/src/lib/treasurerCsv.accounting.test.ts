import { describe, expect, it } from 'vitest';
import { accountingCsv, type TreasurerCsvInput, type TreasurerSignupRow } from './treasurerCsv';
const signup: TreasurerSignupRow = { id: 2, competitionSectionId: 3, sectionName: 'Open', fullName: 'Example Person', amountMinor: 12345, status: 1, createdAt: '2026-10-01', paidAt: '2026-10-28', refundedAmountMinor: 2345, dispositionUpdatedAt: '2026-10-29' };
const input: TreasurerCsvInput = { competitionId: 1, signups: [{ ...signup, status: 2 }] };
describe('accounting exports', () => {
  it('preserves received pence and a partial refund as separate signed transactions', () => {
    const csv = accountingCsv(input, 'xero');
    expect(csv).toContain('Date,Amount,Payee,Description,Reference');
    expect(csv).toContain('28/10/2026,123.45,Example Person');
    expect(csv).toContain('29/10/2026,-23.45,Example Person');
    expect(csv).toContain('MG-1-2');
  });
  it('uses QuickBooks column order and FreeAgent no-header no-quote format', () => {
    expect(accountingCsv(input, 'quickbooks').split('\r\n')[0]).toBe('Date,Description,Amount');
    const csv = accountingCsv({ ...input, signups: [{ ...signup, fullName: 'Example, "Person"\nDemo' }] }, 'freeagent');
    expect(csv).toMatch(/^28\/10\/2026,123\.45,MG-1-2/);
    expect(csv).not.toContain('"'); expect(csv).not.toContain('\n');
    expect(csv.split(',')).toHaveLength(3);
  });
  it('excludes pending payments and test orders; prevents formula injection', () => {
    const csv = accountingCsv({ signups: [{ ...signup, status: 0 }, { ...signup, id: 3, fullName: '  =1+2' }], orders: [{ id: 4, competitionId: 1, status: 2, totalMinor: 100, createdAt: '', isTestOrder: true, lines: [] }] }, 'xero');
    expect(csv.split('\r\n')).toHaveLength(2); expect(csv).toContain("'=1+2");
  });
  it('does not invent missing dates or round fractional pence', () => {
    expect(() => accountingCsv({ signups: [{ ...signup, paidAt: null }] }, 'xero')).toThrow('date');
    expect(() => accountingCsv({ signups: [{ ...signup, paidAt: '2026-02-30' }] }, 'xero')).toThrow('date');
    expect(() => accountingCsv({ signups: [{ ...signup, amountMinor: 1.5 }] }, 'xero')).toThrow('pence');
  });
  it.each(['xero', 'quickbooks', 'freeagent'] as const)('refuses legacy refunded entries whose receipt date was erased (%s)', preset => {
    expect(() => accountingCsv({ signups: [{ ...signup, status: 2, paidAt: null, feeDisposition: 'Refunded' }] }, preset)).toThrow('date');
  });
  it('keeps paid receipts after withdrawal or retained fees, without inventing unpaid cancellation receipts', () => {
    const csv = accountingCsv({ signups: [
      { ...signup, status: 3, isWithdrawn: true, refundPending: true, feeDisposition: 'RefundPending' },
      { ...signup, id: 3, status: 3, isWithdrawn: true, feeDisposition: 'Retained' },
      { ...signup, id: 4, status: 3, paidAt: null, feeDisposition: 'None' },
      { ...signup, id: 5, status: 0 },
    ] }, 'xero');
    expect(csv.split('\r\n')).toHaveLength(3);
    expect(csv).toContain('MG-2'); expect(csv).toContain('MG-3');
    expect(csv).not.toContain('MG-4'); expect(csv).not.toContain('MG-5');
    expect(csv).not.toContain('-123.45');
    expect(() => accountingCsv({ signups: [{ ...signup, status: 3, paidAt: null, feeDisposition: 'Retained' }] }, 'xero')).toThrow('date');
  });
  it('uses the UK calendar day at midnight in BST and preserves date-only values', () => {
    for (const paidAt of ['2026-06-01T23:30:00Z', '2026-06-01T23:30:00']) {
      expect(accountingCsv({ signups: [{ ...signup, paidAt }] }, 'xero')).toContain('02/06/2026,123.45');
    }
    expect(accountingCsv({ signups: [{ ...signup, paidAt: '2026-06-01' }] }, 'xero')).toContain('01/06/2026,123.45');
    expect(accountingCsv({ signups: [{ ...signup, paidAt: '2026-12-01T23:30:00Z' }] }, 'xero')).toContain('01/12/2026,123.45');
    expect(() => accountingCsv({ signups: [{ ...signup, paidAt: '2026-06-01Tinvalid' }] }, 'xero')).toThrow('date');
  });
  it('exports shop refunds and refuses a mixed currency', () => {
    const order = { id: 4, competitionId: 1, status: 5, totalMinor: 100, createdAt: '2026-10-01', paidAt: '2026-10-02', refundedAt: '2026-10-03', lines: [] };
    const csv = accountingCsv({ signups: [], orders: [order] }, 'xero');
    expect(csv).toContain('02/10/2026,1.00'); expect(csv).toContain('03/10/2026,-1.00');
    expect(() => accountingCsv({ signups: [], orders: [{ ...order, currency: 'EUR' }] }, 'xero')).toThrow('GBP');
  });
});
