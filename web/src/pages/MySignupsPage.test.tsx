import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { MySignup } from '../types';
import { MySignupsPage, type ExtendedMySignup } from './MySignupsPage';

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
    expect(first).toHaveTextContent('Open Teams · Stockport A');
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your signups.');
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
});
