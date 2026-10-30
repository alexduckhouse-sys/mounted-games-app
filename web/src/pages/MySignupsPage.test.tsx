import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { MySignup } from '../types';
import { MySignupsPage, type ExtendedMySignup } from './MySignupsPage';
import { autoConfirm } from '../test/confirm';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('./commerce/DemoEntryPayment', () => ({ DemoEntryPayment: ({ signupId }: { signupId: number }) => <span>demo payment {signupId}</span> }));

const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
const signup = (id: number, extra: Partial<MySignup> = {}): MySignup => ({
  id, competitionId: id + 10, competitionName: `Event ${id}`, competitionStart: future, competitionSectionId: 1, sectionName: 'Under 14', fullName: 'Ellie Hart',
  amountMinor: 1800, status: 0, createdAt: '2026-10-01T00:00:00Z', ...extra,
});
const mockSignups = (rows: ExtendedMySignup[]) => vi.mocked(api.get).mockImplementation(async url => ({ data: String(url) === '/me/signups' ? rows : [] }) as never);
const mount = () => render(<MemoryRouter><MySignupsPage /></MemoryRouter>);

beforeEach(() => {
  auth.user = { id: 'u1' };
  mockSignups([]);
});

const openRow = async (name: string | RegExp) => {
  await userEvent.click(await screen.findByRole('button', { name }));
  return within(await screen.findByRole('dialog'));
};
const closeSheet = async () => {
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
};

describe('MySignupsPage', () => {
  it('asks a visitor to sign in', () => {
    auth.user = null;
    mount();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('says it is loading while the entries are on their way', async () => {
    vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {}));
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading your entries…');
  });

  it('offers to browse competitions when the person has no entries', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'Browse competitions' })).toHaveAttribute('href', '/events');
  });

  it('shows one plain row per entry, coming up and past, with the status on the right', async () => {
    mockSignups([
      signup(1, { teamName: 'Stockport A', sectionName: 'Teams Open' }),
      signup(2, { status: 1, paidAt: '2026-10-12T10:00:00Z', amountMinor: 9500 }),
      signup(3, { competitionStart: old, status: 2 }),
      signup(4, { competitionStart: old, status: 3, amountMinor: 0 }),
    ]);
    mount();
    const coming = await screen.findByRole('region', { name: 'Coming up' });
    const past = screen.getByRole('region', { name: 'Past' });
    const rows = within(coming).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Event 1');
    expect(rows[0]).toHaveTextContent('Open · £18.00');
    // Not paid is amber and bold; everything else is plain grey.
    expect(within(rows[0]).getByText('Not paid')).toHaveClass('sp-st-amber');
    expect(rows[1]).toHaveTextContent('Under 14 · £95.00');
    expect(within(rows[1]).getByText('Paid')).not.toHaveClass('sp-st-amber');
    expect(within(past).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Refunded'), expect.stringContaining('Cancelled')]);
    expect(within(past).getByText(/Free/)).toBeInTheDocument();
    // Nothing to tap on the rows but the row itself.
    expect(screen.queryByRole('link', { name: /How to pay/ })).not.toBeInTheDocument();
  });

  it('says Demo paid for an entry paid through the demo checkout, and Paid for the rest', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => (String(url).includes('/arrival-') ? { data: [] } : String(url) === '/commerce/entry-payments/mine'
      ? { data: [{ id: 5, target: 1, targetId: 1, isTest: true, status: 0 }, { id: 6, target: 0, targetId: 2, isTest: true, status: 0 }] }
      : { data: [signup(1, { status: 1, paidAt: '2026-10-12T10:00:00Z' }), signup(2, { status: 1, paidAt: '2026-10-12T10:00:00Z' })] }) as never);
    mount();
    const coming = await screen.findByRole('region', { name: 'Coming up' });
    await waitFor(() => expect(within(coming).getByRole('button', { name: /Event 1/ })).toHaveTextContent('Demo paid'));
    // A test payment for an order (target 0) with the same number doesn't count.
    expect(within(coming).getByRole('button', { name: /Event 2/ })).not.toHaveTextContent('Demo');
    expect(within(coming).getByRole('button', { name: /Event 2/ })).toHaveTextContent('Paid');
    const sheet = await openRow(/^Event 1/);
    expect(sheet.getByText(/Demo paid on/)).toBeInTheDocument();
  });

  it('reads Paid when the list of demo payments can’t be loaded', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).includes('/arrival-')) return { data: [] } as never;
      if (String(url) === '/commerce/entry-payments/mine') throw new Error('offline');
      return { data: [signup(1, { status: 1 })] } as never;
    });
    mount();
    expect(await screen.findByRole('button', { name: /Event 1/ })).toHaveTextContent('Paid');
  });

  it('opens a sheet for an unpaid entry with How to pay, to the event’s details', async () => {
    mockSignups([signup(1), signup(2, { status: 1 })]);
    mount();
    const sheet = await openRow(/^Event 1/);
    const pay = sheet.getByRole('link', { name: 'How to pay for Event 1' });
    expect(pay).toHaveAttribute('href', '/competitions/11/details');
    expect(pay).toHaveClass('kit-pill-fill');
    expect(sheet.getByText(/Under 14 · Ellie Hart · £18.00 · Not paid/)).toBeInTheDocument();
    await closeSheet();
    // A paid entry has nothing to pay.
    const paid = await openRow(/^Event 2/);
    expect(paid.queryByRole('link', { name: /How to pay/ })).not.toBeInTheDocument();
    expect(paid.getByText(/· Paid/)).toBeInTheDocument();
  });

  it('shows the Pony Club inside the sheet, and the demo payment note for paid entries only', async () => {
    mockSignups([signup(1, { ponyClubName: 'Cheshire PC' }), signup(2, { amountMinor: 0 })]);
    mount();
    const first = await openRow(/^Event 1/);
    expect(first.getByText('Pony Club: Cheshire PC')).toBeInTheDocument();
    expect(first.getByText('demo payment 1')).toBeInTheDocument();
    await closeSheet();
    const second = await openRow(/^Event 2/);
    expect(second.queryByText(/demo payment/)).not.toBeInTheDocument();
  });

  it('says so when the entries will not load', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your entries. Check your signal and try again.');
    mockSignups([signup(3)]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Event 3')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  const incoming = (): ExtendedMySignup => ({
    ...signup(5, { sectionName: 'Open Pairs', amountMinor: 900 }),
    lookingForPair: true,
    pairRequestFromSignupId: 4,
    pairRequestFromName: 'Alice Partner',
    pairRequestFromClub: 'Cheshire PC',
    pairRequestStatus: 'Pending',
  });

  it('shows an incoming pair request as its own small card at the top, and lets a rider accept it', async () => {
    mockSignups([incoming()]);
    vi.mocked(api.post).mockResolvedValue({
      data: { ...incoming(), lookingForPair: false, teamId: 22, teamName: 'Alice Partner & Ellie Hart', pairRequestStatus: 'Accepted' },
    });
    mount();
    const card = within(await screen.findByRole('region', { name: 'Pair request' }));
    expect(card.getByText('Alice Partner · Cheshire PC')).toBeInTheDocument();
    expect(card.getByText('Event 5 · Open Pairs')).toBeInTheDocument();
    expect(card.getByRole('button', { name: /^Decline/ })).toHaveClass('sp-red');
    expect(card.getByRole('button', { name: 'Accept pair request from Alice Partner' })).toHaveTextContent(/^Accept$/);
    await userEvent.click(card.getByRole('button', { name: 'Accept pair request from Alice Partner' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/my/signups/5/pair-respond', { accept: true }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pair request' })).not.toBeInTheDocument());
  });

  it('lets a rider decline a pair request, and says so when that fails', async () => {
    mockSignups([incoming()]);
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline pair request from Alice Partner' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/my/signups/5/pair-respond', { accept: false }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t update the pair request. Check your signal and try again.');
    // The request stays until the server has answered.
    expect(screen.getByRole('region', { name: 'Pair request' })).toBeInTheDocument();
  });

  it('says a pair accepted before payment gets its team once both entries are paid', async () => {
    mockSignups([{ ...signup(8), pairRequestFromSignupId: 9, pairRequestFromName: 'Cara Rider', pairRequestStatus: 'AcceptedAwaitingPayment' }]);
    mount();
    const sheet = await openRow(/^Event 8/);
    expect(sheet.getByText('Paired with Cara Rider. The team is made once both entries are paid')).toBeInTheDocument();
    // It isn't an incoming request any more, so there is nothing to accept.
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('says in the sheet when a pair request was sent and is waiting', async () => {
    mockSignups([{ ...signup(6), pairRequestToSignupId: 7, pairRequestToName: 'Bea Rider', pairRequestStatus: 'Pending', lookingForPair: true, stablesCount: 1, waitingForGuestSpot: true, lookingForGuestRiders: true }]);
    mount();
    const sheet = await openRow(/^Event 6/);
    expect(sheet.getByText('Pair request sent to Bea Rider, waiting for an answer')).toBeInTheDocument();
    expect(sheet.getByText('Looking for a pair partner (50% entry)')).toBeInTheDocument();
    expect(sheet.getByText('Waiting for a guest rider place')).toBeInTheDocument();
    expect(sheet.getByText('Looking for guest riders')).toBeInTheDocument();
    expect(sheet.getByText('Stabling: 1 stable')).toBeInTheDocument();
  });

  it('lets a rider or manager withdraw an upcoming pre-draw entry from the sheet, in red, after asking', async () => {
    const entry: ExtendedMySignup = {
      ...signup(8, { status: 1, paidAt: '2026-10-12T10:00:00Z', amountMinor: 4000, teamName: 'Cheshire A' }),
      stablesCount: 2,
      stablingClubOrTeam: 'Cheshire PC',
      drawComplete: false,
    };
    mockSignups([entry]);
    vi.mocked(api.post).mockResolvedValue({
      data: { ...entry, status: 3, isWithdrawn: true, refundPending: true, teamId: null, teamName: null },
    });
    mount();
    const sheet = await openRow(/^Event 8/);
    expect(sheet.getByText(/Stabling: 2 stables \(Cheshire PC\)/)).toBeInTheDocument();
    expect(sheet.getByText(/Paid on 12 Oct/)).toBeInTheDocument();
    const asked = autoConfirm(true);
    const withdraw = sheet.getByRole('button', { name: 'Withdraw' });
    expect(withdraw).toHaveClass('kit-redtext');
    await userEvent.click(withdraw);
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Cheshire A at Event 8. You can’t withdraw once the draw has happened.'));
    expect(asked.titles).toEqual(['Withdraw this entry?']);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/my/signups/8/withdraw', {}));
    expect(await screen.findByText('Refund pending')).toBeInTheDocument();
  });

  it('does nothing when the rider changes their mind, and says so when withdrawing fails', async () => {
    const entry: ExtendedMySignup = { ...signup(8, { status: 1, amountMinor: 4000, teamName: 'Cheshire A' }), drawComplete: false };
    mockSignups([entry]);
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    mount();
    autoConfirm(false);
    await userEvent.click((await openRow(/^Event 8/)).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.post).not.toHaveBeenCalled();
    autoConfirm(true);
    await userEvent.click((await openRow(/^Event 8/)).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t withdraw this entry. Check your signal and try again.');
  });

  it('shows the API’s draw-happened message when the draw was made after the page loaded', async () => {
    const entry: ExtendedMySignup = { ...signup(8, { status: 1, amountMinor: 4000, teamName: 'Cheshire A' }), drawComplete: false };
    mockSignups([entry]);
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { code: 'draw-happened', message: 'You can’t withdraw once the draw has happened.' } } });
    mount();
    autoConfirm(true);
    await userEvent.click((await openRow(/^Event 8/)).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You can’t withdraw once the draw has happened.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Check your signal');
  });

  it('keeps the signal advice for a 409 that is not about the draw', async () => {
    const entry: ExtendedMySignup = { ...signup(8, { status: 1, amountMinor: 4000, teamName: 'Cheshire A' }), drawComplete: false };
    mockSignups([entry]);
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { message: 'This entry is no longer active.' } } });
    mount();
    autoConfirm(true);
    await userEvent.click((await openRow(/^Event 8/)).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t withdraw this entry. Check your signal and try again.');
  });

  it('hides Withdraw once the draw has taken place', async () => {
    mockSignups([{ ...signup(9, { status: 1, amountMinor: 4000 }), drawComplete: true }]);
    mount();
    const sheet = await openRow(/^Event 9/);
    expect(sheet.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});

describe('withdrawal and trusted multi-team declarations', () => {
  it('shows completed refunds rather than stale withdrawal text', async () => {
    mockSignups([{ ...signup(1, { status: 2 }), isWithdrawn: true, refundPending: false }]);
    mount();
    expect(await screen.findByText('Refunded')).toBeInTheDocument();
    expect(screen.queryByText('Refund pending')).not.toBeInTheDocument();
  });

  it('shows a withdrawn entry and a waiting-list entry in plain words', async () => {
    mockSignups([{ ...signup(1, { status: 3 }), isWithdrawn: true }, { ...signup(2), isWaitlist: true }]);
    mount();
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
    expect(screen.getByText('Waiting list')).not.toHaveClass('sp-st-amber');
  });

  it('links every granted team in the sheet, and keeps the primary-team fallback', async () => {
    mockSignups([
      { ...signup(1, { status: 1 }), declarationAccessGranted: true, linkedTeams: [{ id: 21, name: 'Synthetic A' }, { id: 22, name: 'Synthetic B' }] },
      { ...signup(2, { status: 1, teamId: 23, teamName: 'Synthetic C' }), declarationAccessGranted: true },
      { ...signup(3, { status: 1 }), declarationAccessGranted: false, linkedTeams: [{ id: 24, name: 'Untrusted' }] },
      { ...signup(4, { status: 3 }), declarationAccessGranted: true, linkedTeams: [{ id: 25, name: 'Cancelled' }] },
    ]);
    mount();
    const many = await openRow(/^Event 1/);
    expect(many.getByRole('link', { name: 'Dec form for Synthetic A' })).toHaveAttribute('href', '/competitions/11/declarations?team=21');
    expect(many.getByRole('link', { name: 'Dec form for Synthetic B' })).toHaveAttribute('href', '/competitions/11/declarations?team=22');
    await closeSheet();
    const one = await openRow(/^Event 2/);
    expect(one.getByRole('link', { name: 'Fill in dec form' })).toHaveAttribute('href', '/competitions/12/declarations?team=23');
    await closeSheet();
    expect((await openRow(/^Event 3/)).queryByRole('link', { name: /dec form/i })).not.toBeInTheDocument();
    await closeSheet();
    expect((await openRow(/^Event 4/)).queryByRole('link', { name: /dec form/i })).not.toBeInTheDocument();
  });
});

it('keeps withdrawal available after the event starts if no draw exists', async () => {
  mockSignups([{ ...signup(1, { competitionStart: old, status: 1 }), drawComplete: false }]);
  mount();
  expect((await openRow(/^Event 1/)).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
});
