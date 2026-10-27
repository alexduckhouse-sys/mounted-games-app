import { describe, expect, it } from 'vitest';
import type { SectionSignup } from '../types';
import { arrivalManifestCsv, buildClubSlug, computeFeeDispositionLedger, groupClubInvoices } from './entryWorkflows';

const signup = (id: number, overrides: Partial<SectionSignup> = {}): SectionSignup => ({
  id, competitionSectionId: 10, sectionName: 'Open', fullName: `Test entrant ${id}`,
  amountMinor: 4000, status: 0, createdAt: '2031-06-01T10:00:00Z', ...overrides,
});

describe('entry workflow fallbacks', () => {
  it('includes vehicle-only arrivals with no stables and defaults their counts', () => {
    const csv = arrivalManifestCsv([
      signup(1, { vehicleRegistration: ' TEST BOX ', stablesCount: undefined, teamsCount: undefined }),
      signup(2),
    ]);
    expect(csv.split(/\r?\n/)).toEqual([
      'Arrival window,Vehicle registration,Club or team,Entrant,Section,Teams,Stables,Payment status',
      'Other / not specified,TEST BOX,Unaffiliated,Test entrant 1,Open,1,0,Pending',
    ]);
  });

  it('keeps a withdrawn entry with no fee decision visible without counting it as a refund or credit', () => {
    const entry = signup(1, { isWithdrawn: true });
    expect(computeFeeDispositionLedger([entry])).toEqual({
      totalRetainedMinor: 0, totalRefundedMinor: 0, refundsPendingMinor: 0,
      creditsRolledOverMinor: 0, rows: [{ ...entry, feeDisposition: 'None' }],
    });
  });

  it('groups clubs case-insensitively, sorts invoices and defaults missing team and stable counts', () => {
    const groups = groupClubInvoices(7, [
      signup(1, { ponyClubName: 'Test Zebra' }),
      signup(2, { ponyClubName: 'test zebra', status: 1 }),
      signup(3, { ponyClubName: 'Test Apple', teamsCount: 0 }),
      signup(4, { ponyClubName: 'test apple', status: 1, stablesCount: 2 }),
      signup(5, { ponyClubName: null }), signup(6),
    ]);
    expect(groups.map((group) => group.clubName)).toEqual(['Test Apple', 'Test Zebra']);
    expect(groups[0]).toMatchObject({
      signupsCount: 2, teamsCount: 2, stablesCount: 2,
      totalAmountMinor: 8000, totalDueMinor: 4000, totalPaidMinor: 4000,
      clubBacsReference: 'MGC-7-TEST-APPLE',
    });
    expect(groups[1]).toMatchObject({ signupsCount: 2, teamsCount: 2, stablesCount: 0 });
    expect(buildClubSlug(null)).toBe('CLUB');
    expect(buildClubSlug(undefined)).toBe('CLUB');
  });
});
