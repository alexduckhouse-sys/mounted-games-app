import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { ArrivalBooking } from '../components/wallet/walletTypes';
import { autoConfirm } from '../test/confirm';
import { MySignupsPage, type ExtendedMySignup } from './MySignupsPage';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
// The same user object every render, as the real hook gives, so the page doesn't reload its entries each time.
const auth = vi.hoisted(() => ({ user: { id: 'u1' } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./commerce/DemoEntryPayment', () => ({ DemoEntryPayment: () => null }));

const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const signup = (extra: Partial<ExtendedMySignup> = {}): ExtendedMySignup => ({
  id: 1, competitionId: 11, competitionName: 'Spring Games', competitionStart: future, competitionSectionId: 1, sectionName: 'Under 14', fullName: 'Pat Parent',
  amountMinor: 1800, status: 0, createdAt: '2026-10-01T00:00:00Z', ...extra,
});
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

async function open(rows: ExtendedMySignup[], bookings: ArrivalBooking[] = []) {
  vi.mocked(api.get).mockImplementation(async url => ({ data: String(url) === '/me/signups' ? rows : String(url).endsWith('/arrival-bookings') ? bookings : [] }) as never);
  render(<MemoryRouter><MySignupsPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', { name: /Spring Games/ }));
  return within(await screen.findByRole('dialog'));
}

beforeEach(() => vi.clearAllMocks());

describe('my entries: rider, offers and arrival pass', () => {
  it('shows the rider on your own entry but never a phone number', async () => {
    const sheet = await open([signup({ guest: {
      riderName: 'Remy Rider', riderDateOfBirth: '2018-04-05', ponyName: 'Biscuit',
      guardianName: 'Pat Parent', guardianPhone: '07700900123', emergencyContactName: 'Sam', emergencyContactPhone: '07700900456',
    } })]);
    expect(sheet.getByText(/Rider: Remy Rider/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('07700');
  });

  it('shows an open waitlist offer with its countdown and accepts it after confirming', async () => {
    const offered = signup({ isWaitlist: true, waitlistOfferExpiresAt: inHours(5) });
    vi.mocked(api.post).mockResolvedValue({ data: { ...offered, isWaitlist: false, waitlistOfferExpiresAt: null } });
    const asked = autoConfirm(true);
    const sheet = await open([offered]);
    expect(sheet.getByRole('status')).toHaveTextContent(/left\. Accept before then/);
    await userEvent.click(sheet.getByRole('button', { name: 'Accept the place' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/11/signups/1/accept-waitlist-spot', {}));
    expect(asked.titles).toContain('Take this place?');
    expect(asked).toHaveBeenCalledWith(expect.stringContaining('This is a demo. No money will be taken or sent, and your entry hasn’t been paid for.'));
    expect(await screen.findByText('Not paid')).toBeInTheDocument();
  });

  it('does not post when the confirmation is cancelled', async () => {
    autoConfirm(false);
    const sheet = await open([signup({ isWaitlist: true, waitlistOfferExpiresAt: inHours(1) })]);
    await userEvent.click(sheet.getByRole('button', { name: 'Accept the place' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says an offer has run out and offers no button', async () => {
    const sheet = await open([signup({ isWaitlist: true, waitlistOfferExpiresAt: inHours(-1) })]);
    expect(sheet.getByText('The offer of a place has run out.')).toBeInTheDocument();
    expect(sheet.queryByRole('button', { name: 'Accept the place' })).not.toBeInTheDocument();
  });

  it('shows the server’s reason when accepting fails', async () => {
    autoConfirm(true);
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'That spot has already been filled.' } } });
    const sheet = await open([signup({ isWaitlist: true, waitlistOfferExpiresAt: inHours(1) })]);
    await userEvent.click(sheet.getByRole('button', { name: 'Accept the place' }));
    expect(await screen.findByText('That spot has already been filled.', undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it('offers an arrival card only from the canonical booking, with its confirmed shop entitlement', async () => {
    const booking: ArrivalBooking = { id: 'example-booking', competitionId: 11, competitionName: 'Spring Games', startDate: future, endDate: null, venue: null,
      vehicleRegistration: 'EXAMPLE', reference: 'example-reference', revision: 1, signupId: 1, admission: 'pending', needsReview: false, voided: false, walletAvailable: false,
      benefits: [{ sourceId: 1, orderLineId: 9, kind: 3, quantity: 2, status: 'paid', fromDate: '2031-05-04', untilDate: '2031-05-06', allocations: [] }] };
    const sheet = await open([signup({ status: 0 })], [booking]);
    expect(await sheet.findByRole('button', { name: 'Download arrival card' })).toBeInTheDocument();
    expect(sheet.getByText('Stabling · 2 · Confirmed')).toBeInTheDocument();
    expect(sheet.getByText('Admission: Payment pending')).toBeInTheDocument();
    expect(sheet.queryByRole('button', { name: 'Add to Apple Wallet' })).not.toBeInTheDocument();
  });

  it('does not infer a pass or paid stabling from a paid entry and legacy stable count', async () => {
    const sheet = await open([signup({ status: 1, stablesCount: 2, stableAssignment: 'Barn B' })]);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions/11/arrival-bookings', { params: { signupId: 1 } }));
    expect(sheet.queryByRole('button', { name: 'Download arrival card' })).not.toBeInTheDocument();
  });

  it('has no arrival card without a canonical booking', async () => {
    const sheet = await open([signup({ status: 0, stablesCount: 2 })]);
    expect(sheet.queryByRole('button', { name: 'Download arrival card' })).not.toBeInTheDocument();
  });
});
