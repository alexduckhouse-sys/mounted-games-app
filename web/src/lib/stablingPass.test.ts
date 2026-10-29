import type { ArrivalBooking } from '../components/wallet/walletTypes';
import { describe, expect, it, vi } from 'vitest';
import {
  buildLorryPassFromBooking,
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
    expect(unallocatedWithStables.clubOrTeamName).toBe('');
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
    const odd = { ...fallbackVenuePass, signupId: '<img src=x>' as unknown as number, stablesCount: '<b>2</b>' as unknown as number };
    const oddHtml = buildOfflineWalletPassHtml(odd);
    expect(oddHtml).not.toContain('<img src=x>');
    expect(oddHtml).not.toContain('<b>2</b>');
    expect(oddHtml).toContain('&lt;img src=x&gt;');

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

const canonical: ArrivalBooking = { id: 'example', competitionId: 7, competitionName: 'Example & <event>', startDate: '2031-05-04', endDate: null, venue: null,
  vehicleRegistration: '', reference: 'opaque-example-reference', revision: 3, admission: 'none', needsReview: false, voided: false, walletAvailable: false,
  benefits: [{ sourceId: 1, orderLineId: 8, kind: 3, quantity: 2, status: 'paid', fromDate: '2031-05-04', untilDate: '2031-05-06', allocations: [{ resource: '<Stable A>', night: '2031-05-04' }] },
    { sourceId: 2, orderLineId: 9, kind: 4, quantity: 1, status: 'paid', fromDate: '2031-05-04', untilDate: '2031-05-06', allocations: [{ resource: 'Hook-up B', night: '2031-05-05' }] },
    { sourceId: 3, orderLineId: 10, kind: 3, quantity: 6, status: 'pending', fromDate: '2031-05-04', untilDate: '2031-05-06', allocations: [] }] };
describe('canonical arrival cards', () => {
  it('prints only paid shop quantities and allocations, without entrant or signup identifiers', () => {
    const pass = buildLorryPassFromBooking(canonical, 'https://example.test///');
    expect(pass.stablesCount).toBe(2); expect(pass.stableAssignment).toBe('<Stable A> (2031-05-04)'); expect(pass.hookupAssignment).toBe('Hook-up B (2031-05-05)');
    expect(pass.verificationUrl).toBe('https://example.test/competitions/7/entries?arrival=opaque-example-reference');
    expect(pass.signupId).toBe(0); expect(pass.entrantName).toBe(''); expect(pass.clubOrTeamName).toBe('Example & <event>');
    const html = buildOfflineWalletPassHtml(pass, '<svg data-example="qr"></svg>');
    expect(html).toContain('&lt;Stable A&gt; (2031-05-04)'); expect(html).not.toContain('<Stable A>'); expect(html).not.toContain(' · #0');
    expect(html).toContain('Staff must check this pass online'); expect(html).toContain('@media print'); expect(html).toContain('<svg data-example="qr"></svg>');
  });
  it.each(['pending', 'unavailable', 'cancelled', 'conflict', 'review'] as const)('never prints a broad PAID badge for %s admission', admission => {
    expect(buildLorryPassFromBooking({ ...canonical, benefits: canonical.benefits.slice(0, 2), admission }).paymentStatus).toBe('PENDING');
  });
  it.each(['pending', 'unavailable', 'cancelled', 'conflict', 'review'] as const)('never prints a broad PAID badge while a benefit is %s', status => {
    expect(buildLorryPassFromBooking({ ...canonical, admission: 'paid', benefits: [{ ...canonical.benefits[0], status }] }).paymentStatus).toBe('PENDING');
  });
  it('marks an empty booking, a voided booking and a legacy booking as pending', () => {
    for (const changes of [{ benefits: [] }, { voided: true }, { needsReview: true }]) expect(buildLorryPassFromBooking({ ...canonical, ...changes }).paymentStatus).toBe('PENDING');
  });
  it('prints confirmed unallocated stabling without inventing a box, and uses the vehicle label', () => {
    const pass = buildLorryPassFromBooking({ ...canonical, vehicleRegistration: 'EXAMPLE', benefits: [{ ...canonical.benefits[0], allocations: [] }] });
    expect(pass.paymentStatus).toBe('PAID'); expect(pass.stableAssignment).toBe('To be allocated'); expect(pass.hookupAssignment).toBeNull(); expect(pass.clubOrTeamName).toBe('EXAMPLE');
    expect(pass.verificationUrl).toMatch(new RegExp(`^${window.location.origin}`));
    expect(buildLorryPassFromBooking({ ...canonical, benefits: [] }).stableAssignment).toBe('No paid stabling');
  });
  it('downloads the printable canonical card and releases its temporary URL', async () => {
    const pass = buildLorryPassFromBooking(canonical); let blob!: Blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value as Blob; return 'blob:example-card'; });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let download = ''; const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { download = this.download; });
    expect(downloadOfflineWalletPass(pass)).toBe('lorry-stabling-pass-7-0.html'); expect(download).toBe('lorry-stabling-pass-7-0.html'); expect(click).toHaveBeenCalledOnce();
    const text = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
    expect(text).toContain('opaque-example-reference'); expect(text).not.toContain('?pass='); expect(blob.type).toBe('text/html;charset=utf-8');
    expect(document.querySelector('a[download]')).toBeNull(); expect(revoke).toHaveBeenCalledWith('blob:example-card');
  });
});
