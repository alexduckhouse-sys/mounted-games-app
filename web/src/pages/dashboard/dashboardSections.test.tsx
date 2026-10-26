import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { team } from '../../test/factories';
import type { CompetitionPickerItem } from '../../types';
import { NeedsYouContext, type NeedsYouValue } from '../profile/needsYou';
import { NeedsYouPanel } from './NeedsYouPanel';
import { QuickActions } from './QuickActions';
import { TodaysEvents } from './TodaysEvents';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
const auth = vi.hoisted(() => ({ roles: [] as string[], owns: [] as number[], clubId: 7 as number | null }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', clubId: auth.clubId },
    hasRole: (role: string) => auth.roles.includes(role),
    canOrganise: (competition?: { id?: number }) => auth.roles.includes('Admin') || (auth.roles.includes('Trainer') && auth.owns.includes(competition?.id ?? -1)),
  }),
}));

const start = new Date();
const item = (id: number, extra: Partial<CompetitionPickerItem> = {}): CompetitionPickerItem => ({ id, name: `Event ${id}`, startDate: start.toISOString(), endDate: null, icon: 'flag', ...extra });

function needs(extra: Partial<NeedsYouValue> = {}): NeedsYouValue {
  return { requests: [], teams: null, decForms: [], count: 0, review: async () => true, ...extra };
}
function mountNeeds(value: NeedsYouValue, events: CompetitionPickerItem[] = []) {
  return render(<MemoryRouter><NeedsYouContext.Provider value={value}><NeedsYouPanel events={events} /></NeedsYouContext.Provider></MemoryRouter>);
}

beforeEach(() => {
  auth.roles = ['Admin'];
  auth.owns = [];
  auth.clubId = 7;
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/competitions/1/signups') return { data: [{ status: 0 }, { status: 1 }, { status: 0 }] } as never;
    if (url === '/competitions/1/dec-form-flags') return { data: [{ teamId: 3, teamName: 'Oak A', declarationFormId: 9, flags: ['Rider is over the weight limit'] }, { teamId: 4, teamName: 'Ash B', declarationFormId: 10, flags: ['Pony is too tall'] }] } as never;
    if (url === '/clubs/7/payouts/summary') return { data: { clubName: 'Stockport PC', maskedAccount: null, ready: false } } as never;
    throw new Error(`unexpected ${url}`);
  });
});

describe('Needs you', () => {
  const request = { userId: 'r1', fullName: 'Sam Lee', email: 's@example.com', clubName: null, requestedAt: '2026-10-20T09:00:00Z' };

  it('shows approvals with inline buttons, dec forms, unpaid entries and payouts that are not ready, each with a link', async () => {
    const review = vi.fn().mockResolvedValue(true);
    mountNeeds(needs({ requests: [request], decForms: [team(3, { competitionId: 4, displayName: 'Oak A' })], review }), [item(1)]);
    const region = within(screen.getByRole('region', { name: 'Needs you' }));
    expect(region.getByText('Sam Lee')).toBeInTheDocument();
    expect(await region.findByRole('link', { name: /2 entries waiting for payment/ })).toHaveAttribute('href', '/competitions/1/details');
    expect(await region.findByRole('link', { name: /2 dec forms flagged/ })).toHaveAttribute('href', '/competitions/1/declarations');
    expect(await region.findByRole('link', { name: /Club payouts aren’t ready/ })).toHaveAttribute('href', '/me/payouts');
    expect(region.getByRole('link', { name: /Dec form needed: Oak A/ })).toHaveAttribute('href', '/competitions/4/declarations?team=3');
    await userEvent.click(region.getByRole('button', { name: 'Approve' }));
    expect(review).toHaveBeenCalledWith(request, 'approve');
  });

  it('asks in a red dialog before declining, and declines only when confirmed', async () => {
    const review = vi.fn().mockResolvedValue(true);
    const asked = autoConfirm([false, true]);
    mountNeeds(needs({ requests: [request], review }));
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Their account stays a member.'));
    expect(review).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(review).toHaveBeenCalledWith(request, 'decline'));
    expect(asked.titles).toEqual(['Decline Sam Lee’s request?', 'Decline Sam Lee’s request?']);
  });

  it('says so when the server refuses', async () => {
    mountNeeds(needs({ requests: [request], review: async () => false, reviewError: 'Nope.' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope.');
  });

  it('is hidden when nothing needs the person, and a trainer only sees events they own', async () => {
    auth.roles = ['Trainer'];
    auth.owns = [2];
    mountNeeds(needs(), [item(1), item(2)]);
    await waitFor(() => expect(api.get).not.toHaveBeenCalledWith('/competitions/1/signups'));
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull();
  });
});

describe('Quick actions', () => {
  const mount = (focus: CompetitionPickerItem | null, today = true) => render(<MemoryRouter><QuickActions focus={focus} today={today} /></MemoryRouter>);
  const hrefs = () => screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]);

  it('gives an admin every action, pointing at the event on today', () => {
    mount(item(5));
    expect(hrefs()).toEqual([
      ['Create competition', '/admin/competitions/new'],
      ['Score nowEvent 5', '/competitions/5/scoring'],
      ['Post an announcementEvent 5', '/competitions/5/chat'],
      ['Go liveEvent 5', '/competitions/5/broadcast'],
      ['On the dayEvent 5', '/admin/competitions/5/format'],
      ['Rules library', '/admin/rules'],
    ]);
  });

  it('gives a trainer Create competition, plus Score now and the rest for their own event only', () => {
    auth.roles = ['Trainer'];
    auth.owns = [5];
    const view = mount(item(5));
    expect(hrefs().map(([label]) => label)).toEqual(['Create competition', 'Score nowEvent 5', 'Post an announcementEvent 5', 'Go liveEvent 5', 'On the dayEvent 5']);
    view.unmount();
    mount(item(6));
    expect(hrefs()).toEqual([['Create competition', '/admin/competitions/new']]);
  });

  it('leaves out Score now and On the day when the event is only later this week', () => {
    mount(item(5), false);
    expect(hrefs().map(([label]) => label)).toEqual(['Create competition', 'Post an announcementEvent 5', 'Go liveEvent 5', 'Rules library']);
  });

  it('shows nothing to a member', () => {
    auth.roles = ['Member'];
    mount(item(5));
    expect(screen.queryByRole('region', { name: 'Quick actions' })).toBeNull();
  });
});

describe('Today’s events', () => {
  it('lists events with a live status and a jump-in link', () => {
    render(<MemoryRouter><TodaysEvents loaded events={[item(1, { live: { heatLabel: 'Heat 2', arenaName: 'Arena 1', sectionName: 'Open' } }), item(2, { startDate: new Date(Date.now() + 3 * 864e5).toISOString(), location: 'Hartpury' })]} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Jump in to Event 1' })).toHaveAttribute('href', '/competitions/1');
    expect(screen.getByText('Open · Heat 2 · Arena 1 on now')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/Hartpury/)).toBeInTheDocument();
  });

  it('says when nothing is on, and waits quietly while loading', () => {
    const view = render(<MemoryRouter><TodaysEvents loaded={false} events={[]} /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Looking for what’s on');
    view.rerender(<MemoryRouter><TodaysEvents loaded events={[]} /></MemoryRouter>);
    expect(screen.getByText('Nothing is on today or this week.')).toBeInTheDocument();
  });
});
