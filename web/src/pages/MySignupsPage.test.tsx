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
const mount = () => render(<MemoryRouter><MySignupsPage /></MemoryRouter>);

beforeEach(() => {
  auth.user = { id: 'u1' };
  vi.mocked(api.get).mockResolvedValue({ data: [] });
});

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
    expect(screen.getByRole('status')).toHaveTextContent('Loading your signups…');
  });

  it('offers to browse competitions when the person has no entries', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'Browse competitions' })).toHaveAttribute('href', '/events');
  });

  it('groups entries into coming up and past, with the price and status of each', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      signup(1, { teamName: 'Stockport A', sectionName: 'Teams Open' }),
      signup(2, { status: 1, paidAt: '2026-10-12T10:00:00Z', amountMinor: 9500 }),
      signup(3, { competitionStart: old, status: 2 }),
      signup(4, { competitionStart: old, status: 3, amountMinor: 0 }),
    ] });
    mount();
    const coming = await screen.findByRole('region', { name: 'Coming up' });
    const past = screen.getByRole('region', { name: 'Past' });
    expect(within(coming).getAllByRole('listitem')).toHaveLength(2);
    const first = within(coming).getAllByRole('listitem')[0];
    expect(first).toHaveTextContent('Event 1');
    expect(first).toHaveTextContent('Open · Stockport A');
    expect(first).toHaveTextContent('£18.00');
    expect(first).toHaveTextContent('Awaiting payment');
    expect(within(coming).getAllByRole('listitem')[1]).toHaveTextContent('Paid 12 Oct');
    expect(within(coming).getAllByRole('listitem')[1]).toHaveTextContent('£95.00');
    expect(within(past).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Refunded'), expect.stringContaining('Cancelled')]);
    expect(within(past).getByText('Free')).toBeInTheDocument();
  });

  it('gives only the awaiting payment entry a How to pay link, to the event’s details', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [signup(1), signup(2, { status: 1 })] });
    mount();
    const pay = await screen.findAllByRole('link', { name: /How to pay/ });
    expect(pay).toHaveLength(1);
    expect(pay[0]).toHaveAttribute('href', '/competitions/11/details');
    expect(screen.queryByRole('button', { name: /Cancel entry/ })).not.toBeInTheDocument();
  });

  it('shows the Pony Club, and the demo payment note for paid entries only', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [signup(1, { ponyClubName: 'Cheshire PC' }), signup(2, { amountMinor: 0 })] });
    mount();
    expect(await screen.findByText('Pony Club: Cheshire PC')).toBeInTheDocument();
    expect(screen.getByText('demo payment 1')).toBeInTheDocument();
    expect(screen.queryByText('demo payment 2')).not.toBeInTheDocument();
  });

  it('says so when the entries will not load', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your signups. Check your signal and try again.');
    vi.mocked(api.get).mockResolvedValue({ data: [signup(3)] });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Event 3')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lets a rider accept an incoming pair-up request', async () => {
    const incoming: ExtendedMySignup = {
      ...signup(5, { sectionName: 'Open Pairs', amountMinor: 900 }),
      lookingForPair: true,
      pairRequestFromSignupId: 4,
      pairRequestFromName: 'Alice Partner',
      pairRequestFromClub: 'Cheshire PC',
      pairRequestStatus: 'Pending',
    };
    vi.mocked(api.get).mockResolvedValue({ data: [incoming] });
    vi.mocked(api.post).mockResolvedValue({
      data: { ...incoming, lookingForPair: false, teamId: 22, teamName: 'Alice Partner & Ellie Hart', pairRequestStatus: 'Accepted' },
    });
    mount();
    expect(await screen.findByText(/Pair request from Alice Partner/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept pair' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/my/signups/5/pair-respond', { accept: true }));
    expect(await screen.findByText(/Alice Partner & Ellie Hart/)).toBeInTheDocument();
  });

  it('lets a rider or manager withdraw an upcoming pre-draw entry and shows Withdrawn — refund pending', async () => {
    const entry: ExtendedMySignup = {
      ...signup(8, { status: 1, paidAt: '2026-10-12T10:00:00Z', amountMinor: 4000, teamName: 'Cheshire A' }),
      stablesCount: 2,
      stablingClubOrTeam: 'Cheshire PC',
      drawComplete: false,
    };
    vi.mocked(api.get).mockResolvedValue({ data: [entry] });
    vi.mocked(api.post).mockResolvedValue({
      data: { ...entry, status: 3, isWithdrawn: true, refundPending: true, teamId: null, teamName: null },
    });
    mount();
    expect(await screen.findByText(/Stabling: 2 stables \(Cheshire PC\)/)).toBeInTheDocument();
    const asked = autoConfirm(true);
    const withdrawBtn = screen.getByRole('button', { name: 'Withdraw Entry' });
    await userEvent.click(withdrawBtn);
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Cheshire A at Event 8. You can’t withdraw once the draw has happened.'));
    expect(asked.titles).toEqual(['Withdraw this entry?']);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/my/signups/8/withdraw', {}));
    expect(await screen.findByText('Withdrawn — refund pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw Entry' })).not.toBeInTheDocument();
  });

  it('does nothing when the rider changes their mind, and says so when withdrawing fails', async () => {
    const entry: ExtendedMySignup = { ...signup(8, { status: 1, amountMinor: 4000, teamName: 'Cheshire A' }), drawComplete: false };
    vi.mocked(api.get).mockResolvedValue({ data: [entry] });
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    mount();
    autoConfirm(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw Entry' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.post).not.toHaveBeenCalled();
    autoConfirm(true);
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw Entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t withdraw this entry. Check your signal and try again.');
  });

  it('shows the API’s draw-happened message when the draw was made after the page loaded', async () => {
    const entry: ExtendedMySignup = { ...signup(8, { status: 1, amountMinor: 4000, teamName: 'Cheshire A' }), drawComplete: false };
    vi.mocked(api.get).mockResolvedValue({ data: [entry] });
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { code: 'draw-happened', message: 'You can’t withdraw once the draw has happened.' } } });
    mount();
    autoConfirm(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw Entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You can’t withdraw once the draw has happened.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Check your signal');
  });

  it('keeps the signal advice for a 409 that is not about the draw', async () => {
    const entry: ExtendedMySignup = { ...signup(8, { status: 1, amountMinor: 4000, teamName: 'Cheshire A' }), drawComplete: false };
    vi.mocked(api.get).mockResolvedValue({ data: [entry] });
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { message: 'This entry is no longer active.' } } });
    mount();
    autoConfirm(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw Entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t withdraw this entry. Check your signal and try again.');
  });

  it('hides Withdraw Entry once the draw has taken place', async () => {
    const drawnEntry: ExtendedMySignup = {
      ...signup(9, { status: 1, amountMinor: 4000 }),
      drawComplete: true,
    };
    vi.mocked(api.get).mockResolvedValue({ data: [drawnEntry] });
    mount();
    expect(await screen.findByText('Event 9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw Entry' })).not.toBeInTheDocument();
  });
});

describe('withdrawal and trusted multi-team declarations', () => {
  it('shows completed refunds rather than stale withdrawal text', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ ...signup(1, { status: 2 }), isWithdrawn: true, refundPending: false }] });
    mount();
    expect(await screen.findByText('Refunded')).toBeInTheDocument();
    expect(screen.queryByText('Withdrawn — refund pending')).not.toBeInTheDocument();
  });
  it('links every granted team and keeps the primary-team fallback', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { ...signup(1, { status: 1 }), declarationAccessGranted: true, linkedTeams: [{ id: 21, name: 'Synthetic A' }, { id: 22, name: 'Synthetic B' }] },
      { ...signup(2, { status: 1, teamId: 23, teamName: 'Synthetic C' }), declarationAccessGranted: true },
      { ...signup(3, { status: 1 }), declarationAccessGranted: false, linkedTeams: [{ id: 24, name: 'Untrusted' }] },
      { ...signup(4, { status: 3 }), declarationAccessGranted: true, linkedTeams: [{ id: 25, name: 'Cancelled' }] },
    ] });
    mount();
    expect(await screen.findByRole('link', { name: 'Dec form for Synthetic A' })).toHaveAttribute('href', '/competitions/11/declarations?team=21');
    expect(screen.getByRole('link', { name: 'Dec form for Synthetic B' })).toHaveAttribute('href', '/competitions/11/declarations?team=22');
    expect(screen.getByRole('link', { name: 'Dec form for Synthetic C' })).toHaveAttribute('href', '/competitions/12/declarations?team=23');
    expect(screen.getAllByRole('link', { name: /Dec form for/ })).toHaveLength(3);
  });
});

it('keeps withdrawal available after the event starts if no draw exists', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [{ ...signup(1, { competitionStart: old, status: 1 }), drawComplete: false }] });
  mount();
  expect(await screen.findByRole('button', { name: 'Withdraw Entry' })).toBeInTheDocument();
});
