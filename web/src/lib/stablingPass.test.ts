import { describe, expect, it, vi } from 'vitest';
import {
  buildLorryStablingPassFromMySignup,
  buildLorryStablingPassFromSectionSignup,
  buildOfflineWalletPassHtml,
  downloadOfflineWalletPass,
  parsePassSignupIdFromSearch,
  paymentStatusBadgeLabel,
  stablingPassVerificationPath,
  stablingPassVerificationUrl,
} from './stablingPass';

describe('stablingPass', () => {
  it('maps payment status badges and builds verification URLs', () => {
    expect(paymentStatusBadgeLabel(0)).toBe('PENDING');
    expect(paymentStatusBadgeLabel(1)).toBe('PAID');
    expect(paymentStatusBadgeLabel(2)).toBe('REFUNDED');
    expect(paymentStatusBadgeLabel(3)).toBe('CANCELLED');

    expect(stablingPassVerificationPath(7, 42)).toBe('/competitions/7/entries?pass=42');
    expect(stablingPassVerificationUrl(7, 42, 'https://example.org/')).toBe(
      'https://example.org/competitions/7/entries?pass=42',
    );
  });

  it('parses ?pass= signup IDs from query strings', () => {
    expect(parsePassSignupIdFromSearch('')).toBeNull();
    expect(parsePassSignupIdFromSearch('?pass=abc')).toBeNull();
    expect(parsePassSignupIdFromSearch('?pass=0')).toBeNull();
    expect(parsePassSignupIdFromSearch('?pass=42')).toBe(42);
  });

  it('builds LorryStablingPassData from MySignup and SectionSignup', () => {
    const fromMy = buildLorryStablingPassFromMySignup(
      {
        id: 15,
        competitionId: 3,
        competitionName: 'Summer Championships',
        competitionStart: '2026-07-10T08:00:00Z',
        competitionEnd: '2026-07-12T17:00:00Z',
        competitionLocation: 'Newark Showground',
        competitionPostcode: 'NG24 2NY',
        competitionWhat3Words: '///filled.count.soap',
        competitionSectionId: 8,
        sectionName: 'Open Teams',
        fullName: 'Jamie Carter',
        ponyClubName: 'Warwickshire Hunt',
        amountMinor: 12000,
        status: 1,
        createdAt: '2026-06-01T12:00:00Z',
        stablesCount: 5,
        stableAssignment: 'Barn B, Boxes 14–18',
        hookupAssignment: 'Hook-up Post 4',
        vehicleRegistration: 'AB12 CDE',
        arrivalNotes: 'Arriving Friday 18:00',
      },
      'https://mounted-games-app.vercel.app',
    );

    expect(fromMy.clubOrTeamName).toBe('Warwickshire Hunt');
    expect(fromMy.paymentStatus).toBe('PAID');
    expect(fromMy.stableAssignment).toBe('Barn B, Boxes 14–18');
    expect(fromMy.hookupAssignment).toBe('Hook-up Post 4');
    expect(fromMy.vehicleRegistration).toBe('AB12 CDE');
    expect(fromMy.verificationUrl).toBe(
      'https://mounted-games-app.vercel.app/competitions/3/entries?pass=15',
    );

    const unallocatedWithStables = buildLorryStablingPassFromMySignup({
      id: 16,
      competitionId: 3,
      competitionName: 'Summer Championships',
      competitionStart: '2026-07-10T08:00:00Z',
      competitionSectionId: 8,
      sectionName: 'Open Pairs',
      fullName: 'Robin Page',
      amountMinor: 6000,
      status: 0,
      createdAt: '2026-06-01T12:00:00Z',
      stablesCount: 2,
    });
    expect(unallocatedWithStables.clubOrTeamName).toBe('Unaffiliated');
    expect(unallocatedWithStables.stableAssignment).toBe('To be allocated on arrival');

    const fromSection = buildLorryStablingPassFromSectionSignup(
      {
        id: 21,
        competitionSectionId: 9,
        sectionName: 'Under 14 Teams',
        fullName: 'Alex Morgan',
        stablingClubOrTeam: 'Cotswold A',
        amountMinor: 10000,
        status: 0,
        createdAt: '2026-06-02T10:00:00Z',
        stablesCount: 0,
      },
      {
        id: 4,
        name: 'Autumn Friendly',
        startDate: '2026-09-12T08:00:00Z',
        endDate: null,
        location: null,
        postcode: null,
        what3Words: null,
      },
    );
    expect(fromSection.clubOrTeamName).toBe('Cotswold A');
    expect(fromSection.stableAssignment).toBe('Day parking / no overnight stables');
  });

  it('builds and downloads offline wallet pass HTML', () => {
    const pass = buildLorryStablingPassFromMySignup(
      {
        id: 99,
        competitionId: 5,
        competitionName: 'National Finals & <Show>',
        competitionStart: '2026-08-01T08:00:00Z',
        competitionLocation: 'Arena Park',
        competitionPostcode: 'GL19 3BE',
        competitionWhat3Words: 'filled.count.soap',
        competitionSectionId: 2,
        sectionName: 'Open Teams',
        fullName: 'Jamie Carter',
        ponyClubName: 'Warwickshire Hunt',
        amountMinor: 15000,
        status: 1,
        createdAt: '2026-07-01T12:00:00Z',
        stablesCount: 5,
        stableAssignment: 'Barn B, Boxes 14–18',
        hookupAssignment: 'Hook-up Post 4',
        vehicleRegistration: 'AB12 CDE',
        arrivalNotes: 'Late arrival',
      },
      'https://mounted-games-app.vercel.app',
    );

    const html = buildOfflineWalletPassHtml(pass, '<svg data-testid="qr"></svg>');
    expect(html).toContain('National Finals &amp; &lt;Show&gt;');
    expect(html).toContain('Barn B, Boxes 14–18');
    expect(html).toContain('Hook-up Post 4');
    expect(html).toContain('AB12 CDE');
    expect(html).toContain('///filled.count.soap');
    expect(html).toContain('<svg data-testid="qr"></svg>');

    const fallbackVenuePass = buildLorryStablingPassFromMySignup({
      id: 100,
      competitionId: 5,
      competitionName: 'Local Friendly',
      competitionStart: '2026-08-01T08:00:00Z',
      competitionSectionId: 2,
      sectionName: 'Pairs',
      fullName: 'Robin Page',
      amountMinor: 4000,
      status: 0,
      createdAt: '2026-07-01T12:00:00Z',
    });
    expect(buildOfflineWalletPassHtml(fallbackVenuePass)).toContain('Showground gate');

    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:https://example.org/pass');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const filename = downloadOfflineWalletPass(pass);
    expect(filename).toBe('lorry-stabling-pass-5-99.html');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:https://example.org/pass');

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
