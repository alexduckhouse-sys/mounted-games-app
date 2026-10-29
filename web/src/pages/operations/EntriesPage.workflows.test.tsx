import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { EntriesPage } from './EntriesPage';

const reload = vi.fn();
const competition = {
  id: 7, name: 'Spring Open', startDate: '2031-05-04T09:00:00.000Z', endDate: '2031-05-05T17:00:00.000Z', signupsLocked: false,
  teams: [], sections: [], sessions: [], paymentDestination: 'Sort code 00-00-00', location: 'Showground', postcode: 'AB1 2CD', what3Words: null,
};
vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition, reload }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const base = { competitionSectionId: 11, sectionName: 'Under 12', createdAt: '', teamId: null };
let signups: Array<Record<string, unknown>> = [];
const settings = { competitionId: 7, entriesClosed: false, maxStables: 20, stablesBooked: 8, maxHookups: 5, hookupsBooked: 2 };

function show(path = '/competitions/7/entries') {
  return render(<MemoryRouter initialEntries={[path]}><EntriesPage /></MemoryRouter>);
}

beforeEach(() => {
  signups = [
    { ...base, id: 1, fullName: 'Paid Pat', status: 1, amountMinor: 1000, ponyClubName: 'Heath Club', stablesCount: 2, hookupsCount: 1, stableAssignment: 'Barn B', arrivalWindow: 'FridayEvening', vehicleRegistration: 'AB12 CDE', contactEmail: 'pat@example.test',
      guest: { riderName: 'Kit', riderDateOfBirth: '2015-04-05', ponyName: 'Biscuit', guardianName: 'Pat', guardianPhone: '07700 900001', emergencyContactName: 'Sam', emergencyContactPhone: '07700 900002' } },
    { ...base, id: 2, fullName: 'Pending Pru', status: 0, amountMinor: 1550, ponyClubName: 'Heath Club', contactEmail: 'pru@example.test' },
    { ...base, id: 3, fullName: 'Waiting Wes', status: 0, amountMinor: 1000, isWaitlist: true, contactEmail: 'wes@example.test' },
    { ...base, id: 4, fullName: 'Out Olly', status: 1, amountMinor: 1000, isWithdrawn: true },
    { ...base, id: 5, fullName: 'Recent Rae', status: 0, amountMinor: 1000, contactEmail: 'rae@example.test', lastReminderSentAt: new Date().toISOString() },
    { ...base, id: 6, fullName: 'No Email Ned', status: 0, amountMinor: 1000 },
  ];
  vi.mocked(api.get).mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith('/entries')) return { data: [] } as never;
    if (path.endsWith('/signups')) return { data: signups } as never;
    if (path.endsWith('/entry-settings')) return { data: settings } as never;
    if (path.endsWith('/orders')) return { data: [] } as never;
    if (path === '/declaration-forms') return { data: [] } as never;
    if (path.endsWith('/lock-time')) return { data: { declarationsCloseAt: null } } as never;
    return { data: { config: {}, isStandard: true, formsSubmitted: 0 } } as never;
  });
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  vi.mocked(api.post).mockResolvedValue({ data: {} });
});

describe('EntriesPage filters and capacity', () => {
  it('opens the current booking from a pass QR without marking it paid or checked in', async () => {
    show('/competitions/7/entries?pass=1');
    expect(await screen.findByLabelText('Stable boxes')).toHaveValue('Barn B');
    expect(screen.getByRole('button', { name: 'Show: Paid (1)' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('shows the current withdrawn status when an old pass is scanned', async () => {
    show('/competitions/7/entries?pass=4');
    expect(await screen.findByLabelText('What happens to the fee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show: Withdrawn (1)' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('explains when a pass belongs to no entry in this event', async () => {
    show('/competitions/7/entries?pass=999');
    expect(await screen.findByText(/This pass does not match an entry for this event/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Stable boxes')).not.toBeInTheDocument();
  });

  it('does not present an unavailable pass lookup as a valid booking', async () => {
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((url, ...args) => String(url).endsWith('/signups') ? Promise.reject(new Error('offline')) : get(url, ...args));
    show('/competitions/7/entries?pass=1');
    expect(await screen.findByText('Couldn’t check this pass. Check your signal and try again.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Stable boxes')).not.toBeInTheDocument();
  });

  it('shows counts on each filter and the stable and hook-up totals', async () => {
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Show: All teams' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All teams', 'Paid (1)', 'Pending payment (3)', 'Waitlist (1)', 'Withdrawn (1)']);
    expect(screen.getByText('Stables 8 of 20 booked · Hook-ups 2 of 5 booked')).toBeInTheDocument();
  });

  it('lists pending entries with the amber pill, and Mark paid asks first', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    show();
    await user.click(await screen.findByRole('button', { name: /^Show:/ }));
    await user.click(screen.getByRole('option', { name: 'Pending payment (3)' }));
    expect(screen.getAllByText('Pending payment').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('£15.50 by bank transfer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark Pending Pru paid' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups/2/mark-paid'));
    expect(asked.titles).toEqual(['Mark Pending Pru paid?']);
  });

  it('does not mark paid when the organiser cancels', async () => {
    const user = userEvent.setup();
    autoConfirm(false);
    show();
    await user.click(await screen.findByRole('button', { name: /^Show:/ }));
    await user.click(screen.getByRole('option', { name: 'Pending payment (3)' }));
    await user.click(screen.getByRole('button', { name: 'Mark Pending Pru paid' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the guest rider, staff-only contacts, allocation and arrival on a paid entry', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /^Show:/ }));
    await user.click(screen.getByRole('option', { name: 'Paid (1)' }));
    await user.click(screen.getByRole('button', { name: /Paid Pat/ }));
    expect(screen.getByText(/Rider: Kit · born 05\/04\/2015 · Biscuit/)).toBeInTheDocument();
    expect(screen.getByText('Staff only')).toBeInTheDocument();
    expect(screen.getByText(/Emergency contact: Sam/)).toBeInTheDocument();
    expect(screen.getByLabelText('Stable boxes')).toHaveValue('Barn B');
    await user.clear(screen.getByLabelText('Stable boxes'));
    await user.type(screen.getByLabelText('Stable boxes'), 'Barn C');
    await user.click(screen.getByRole('button', { name: 'Save allocation' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/signups/1/stabling', { stableAssignment: 'Barn C', hookupAssignment: '' }));

    await user.clear(screen.getByLabelText('Vehicle registration'));
    await user.type(screen.getByLabelText('Vehicle registration'), 'xy99 zzz');
    await user.selectOptions(screen.getByLabelText('Arrives'), 'SaturdayMorning');
    await user.click(screen.getByRole('button', { name: 'Save arrival' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/my/signups/1/arrival', { arrivalWindow: 'SaturdayMorning', vehicleRegistration: 'XY99 ZZZ' }));
    expect(screen.getByRole('button', { name: 'Download pass' })).toBeInTheDocument();
  });

  it('offers a waiting-list place after asking, saying how many people are emailed', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    show();
    await user.click(await screen.findByRole('button', { name: /^Show:/ }));
    await user.click(screen.getByRole('option', { name: 'Waitlist (1)' }));
    await user.click(screen.getByRole('button', { name: /Waiting Wes/ }));
    expect(screen.getByText('No offer made yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Offer a place' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups/3/offer-waitlist-spot', {}));
    expect(asked).toHaveBeenCalledWith(expect.stringContaining('We email 1 person'));
  });

  it('shows the countdown on an open offer', async () => {
    signups[2] = { ...signups[2], waitlistOfferExpiresAt: new Date(Date.now() + 5 * 3_600_000 + 30_000).toISOString() };
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /^Show:/ }));
    await user.click(screen.getByRole('option', { name: 'Waitlist (1)' }));
    await user.click(screen.getByRole('button', { name: /Waiting Wes/ }));
    expect(screen.getByText(/^5h \d+m left$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new offer' })).toBeInTheDocument();
  });

  it('records a refund on a withdrawn entry after asking, with the exact amount', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    show();
    await user.click(await screen.findByRole('button', { name: /^Show:/ }));
    await user.click(screen.getByRole('option', { name: 'Withdrawn (1)' }));
    await user.click(screen.getByRole('button', { name: /Out Olly/ }));
    await user.selectOptions(screen.getByLabelText('What happens to the fee'), 'Refunded');
    await user.type(screen.getByLabelText(/Amount refunded/), '7.50');
    await user.click(screen.getByRole('button', { name: 'Save fee decision' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/signups/4/disposition', { feeDisposition: 'Refunded', refundedAmountMinor: 750, dispositionNote: null }));
    expect(asked).toHaveBeenCalledWith(expect.stringContaining('£7.50'));
  });

  it('refuses a refund bigger than the fee', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /^Show:/ }));
    await user.click(screen.getByRole('option', { name: 'Withdrawn (1)' }));
    await user.click(screen.getByRole('button', { name: /Out Olly/ }));
    await user.selectOptions(screen.getByLabelText('What happens to the fee'), 'Refunded');
    await user.type(screen.getByLabelText(/Amount refunded/), '20');
    await user.click(screen.getByRole('button', { name: 'Save fee decision' }));
    expect(await screen.findByText(/can’t be more than the fee of £10/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
});

async function openTool(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: 'Entry tools' }));
  const sheet = await screen.findByRole('dialog', { name: 'Entry tools' });
  await user.click(within(sheet).getByRole('button', { name: new RegExp(name) }));
}

describe('Entry tools', () => {
  it('reminds only people with an email who have not been reminded today, after asking', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    vi.mocked(api.post).mockResolvedValue({ data: { sentCount: 2, failedCount: 0, skippedCount: 0, sentAt: '', signups: [] } });
    show();
    await openTool(user, 'Remind unpaid');
    expect(screen.getByText('No email on file')).toBeInTheDocument();
    expect(screen.getByText(/Reminded recently/)).toBeInTheDocument();
    expect(screen.getByLabelText('Remind Recent Rae')).toBeDisabled();
    expect(screen.getByLabelText('Remind No Email Ned')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Send 1 reminder' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups/send-unpaid-reminders', { signupIds: [2], customNote: null }));
    expect(asked.titles).toEqual(['Email 1 reminder?']);
    expect(await screen.findByText('Sent 2.')).toBeInTheDocument();
  });

  it('matches a bank statement and marks only the ticked lines paid', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    show();
    await openTool(user, 'Match a bank statement');
    const csv = 'Date,Reference,Amount\n01/05/2031,MG-7-2 Pending Pru,15.50\n02/05/2031,Mystery,9.99\n';
    await user.upload(screen.getByLabelText('Bank statement (CSV)'), new File([csv], 'statement.csv', { type: 'text/csv' }));
    expect(await screen.findByText('Matches')).toBeInTheDocument();
    expect(screen.getByText('No match')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /: Mystery$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tick lines to mark paid' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Tick exact matches' }));
    await user.click(screen.getByRole('button', { name: 'Mark 1 line paid · £15.50' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups/2/mark-paid'));
    expect(asked.titles).toEqual(['Mark 1 entry paid?']);
  });

  it('lists a payment of a different amount but leaves it to be checked on the entry', async () => {
    const user = userEvent.setup();
    show();
    await openTool(user, 'Match a bank statement');
    const csv = 'Date,Reference,Amount\n01/05/2031,MG-7-2 Pending Pru,10.00\n';
    await user.upload(screen.getByLabelText('Bank statement (CSV)'), new File([csv], 'statement.csv', { type: 'text/csv' }));
    expect(await screen.findByText('Amount differs')).toBeInTheDocument();
    expect(screen.getByText('Check this one on the entry and mark it paid there if it’s right.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /: MG-7-2 Pending Pru$/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Tick exact matches' }));
    expect(screen.getByRole('button', { name: 'Tick lines to mark paid' })).toBeDisabled();
  });

  it('shows club invoices and marks a club paid with the receipt choice in the question', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    vi.mocked(api.post).mockResolvedValue({ data: { markedPaidCount: 1, totalAmountMinor: 1550 } });
    show();
    await openTool(user, 'Club invoices');
    expect(screen.getByText('Total £25.50 · Due £15.50 · Paid £10')).toBeInTheDocument();
    expect(screen.getByText('Bank reference MGC-7-HEATH-CLUB')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark Heath Club paid' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups/mark-club-paid', { ponyClubName: 'Heath Club', signupIds: [2], sendReceiptEmail: true }));
    expect(asked).toHaveBeenCalledWith(expect.stringContaining('1 email address will get a receipt'));
  });

  it('lists arrivals by window and downloads nothing until asked', async () => {
    const user = userEvent.setup();
    show();
    await openTool(user, 'Arrival list');
    expect(screen.getByText(/Friday evening · AB12 CDE · 2 stables/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Saturday morning · 0' }));
    expect(screen.getByText(/Nobody has booked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  });

  it('totals refunds, kept fees and credits', async () => {
    signups[3] = { ...signups[3], feeDisposition: 'Retained' };
    const user = userEvent.setup();
    show();
    await openTool(user, 'Refunds and credits');
    expect(screen.getByText('Fees kept')).toBeInTheDocument();
    expect(screen.getByText('Fee kept', { selector: '.rf-st' })).toBeInTheDocument();
  });

  it('says so when shop orders cannot load for the treasurer export', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/orders')) throw new Error('offline');
      if (path.endsWith('/signups')) return { data: signups } as never;
      return { data: [] } as never;
    });
    show();
    await openTool(user, 'Treasurer export');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByText(/export would be incomplete/)).toBeInTheDocument();
  });

  it('shows a names-free summary to share', async () => {
    const user = userEvent.setup();
    show();
    await openTool(user, 'Share entries summary');
    const preview = screen.getByLabelText('Summary text');
    expect(preview).toHaveTextContent('Spring Open entries');
    expect(preview).not.toHaveTextContent('Pat');
    expect(screen.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', expect.stringContaining('https://wa.me/?text='));
  });
});

vi.mock('../competition/reliability/SubstitutionRequests', () => ({ SubstitutionRequests: () => null }));
