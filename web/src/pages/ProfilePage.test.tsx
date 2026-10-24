import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { useTeamNotifications } from '../hooks/useTeamNotifications';
import { team } from '../test/factories';
import { ProfilePage } from './ProfilePage';
import { NeedsYouProvider } from './profile/NeedsYouProvider';

import { autoConfirm } from '../test/confirm';
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../hooks/useTeamNotifications', () => ({ useTeamNotifications: vi.fn() }));

interface Options {
  roles?: string[];
  fullName?: string;
  clubName?: string | null;
  competition?: boolean;
}

const setEnabled = vi.fn();
const requests = [
  { userId: 'r1', fullName: 'Sam Lee', email: 'sam@example.com', clubName: 'Stockport PC', requestedAt: '2026-10-20T09:00:00Z' },
  { userId: 'r2', fullName: 'Priya Shah', email: 'priya@example.com', clubName: null, requestedAt: '2026-10-21T09:00:00Z' },
];
let responses: Record<string, unknown>;

function mount(options: Options = {}) {
  const roles = options.roles ?? ['Trainer'];
  const auth: StoredAuth = {
    token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id: 'u1', email: 'alex@example.com', fullName: options.fullName ?? 'Alex Morgan', clubId: options.clubName === null ? null : 7, clubName: options.clubName === undefined ? 'Stockport PC' : options.clubName, roles },
  };
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  if (options.competition) document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify({ id: 4, name: 'Spring Games' }))}; Path=/`;
  return render(
    <MemoryRouter initialEntries={['/me']}>
      <AuthProvider><CurrentCompetitionProvider><NeedsYouProvider>
        <Routes>
          <Route path="/me" element={<ProfilePage />} />
          <Route path="/" element={<p>Home page</p>} />
          <Route path="/teams" element={<p>Teams page</p>} />
        </Routes>
      </NeedsYouProvider></CurrentCompetitionProvider></AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setEnabled.mockReset();
  responses = {
    '/auth/me': {},
    '/competitions/access': [],
    '/trainer/my-teams': [team(1, { competitionId: 4 }), team(2, { competitionId: 4 }), team(3, { competitionId: 9 })],
    '/clubs/7/saved-riders': [
      { id: 1, fullName: 'Mia Clarke', ponyName: 'Bramble' },
      { id: 2, fullName: 'Leo Patel', horseName: 'Starlight' },
      { id: 3, fullName: 'Zoe Evans' },
    ],
    '/declaration-forms': [{ id: 1, teamId: 1 }],
    '/admin/trainer-requests': requests,
  };
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url in responses) return { data: responses[url] };
    throw new Error(`unexpected ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  vi.mocked(useTeamNotifications).mockReturnValue({ enabled: false, setEnabled, permission: 'default' });
});

const section = (name: string) => within(screen.getByRole('region', { name }));
const needsSection = async () => within(await screen.findByRole('region', { name: 'Needs you' }));

describe('ProfilePage: header band', () => {
  it('shows who the person is: initials, name, role badge, club', () => {
    mount({ roles: ['Manager'] });
    expect(screen.getByRole('heading', { name: 'Alex Morgan' })).toBeInTheDocument();
    expect(screen.getByText('AM')).toBeInTheDocument();
    expect(screen.getByText('Team manager')).toHaveClass('mg-badge');
    expect(screen.getAllByText('Stockport PC')).toHaveLength(2);
  });

  it('uses the email when there is no name, and leaves the club out when there is none', () => {
    mount({ roles: ['Member'], fullName: '', clubName: null });
    expect(screen.getByRole('heading', { name: 'alex@example.com' })).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.queryByText('Stockport PC')).not.toBeInTheDocument();
  });

  it('has an edit button that opens the account details', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Account details' })).toHaveAttribute('href', '/me/account');
  });
});

describe('ProfilePage: my club', () => {
  it('lists teams, saved riders and dec forms with their counts, and no members row', async () => {
    mount({ competition: true });
    const club = section('My club');
    expect(await club.findAllByText('3')).toHaveLength(2);
    expect(club.getByRole('link', { name: /Teams/ })).toHaveAttribute('href', '/teams');
    expect(club.getByRole('link', { name: /Dec forms/ })).toHaveAttribute('href', '/declarations');
    expect(await club.findByText('1 of 2')).toBeInTheDocument();
    expect(club.getByText('Saved riders')).toBeInTheDocument();
    expect(club.queryByText(/Members/)).not.toBeInTheDocument();
    expect(club.getByText('Stockport PC')).toBeInTheDocument();
  });

  it('gives a team manager and an admin a Members row, and nobody else', async () => {
    mount({ roles: ['Manager'] });
    expect(await section('My club').findByRole('link', { name: /Members/ })).toHaveAttribute('href', '/me/members');
  });

  it('gives a team manager a Payouts row', async () => {
    mount({ roles: ['Manager'] });
    expect(await section('My club').findByRole('link', { name: /Payouts/ })).toHaveAttribute('href', '/me/payouts');
  });

  it('shows an admin the Members row too', async () => {
    responses['/trainer/my-teams'] = [];
    mount({ roles: ['Admin'], clubName: null });
    expect(section('My club').getByRole('link', { name: /Members/ })).toHaveAttribute('href', '/me/members');
  });

  it('shows no dec form count without a followed competition', async () => {
    mount();
    const club = section('My club');
    expect(await club.findAllByText('3')).toHaveLength(2);
    expect(club.getByRole('link', { name: /Dec forms/ })).toHaveTextContent(/^Dec forms$/);
    expect(api.get).not.toHaveBeenCalledWith('/declaration-forms', expect.anything());
  });

  it('shows no dec form count when none of my teams is in the followed competition', async () => {
    responses['/trainer/my-teams'] = [team(3, { competitionId: 9 })];
    mount({ competition: true });
    expect(await section('My club').findByText('1')).toBeInTheDocument();
    expect(section('My club').getByRole('link', { name: /Dec forms/ })).toHaveTextContent(/^Dec forms$/);
  });

  it('leaves out the counts that could not be loaded', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/auth/me' || url === '/competitions/access') return { data: url === '/auth/me' ? {} : [] };
      throw new Error('offline');
    });
    mount({ competition: true });
    const club = section('My club');
    expect(club.getByRole('link', { name: /Teams/ })).toHaveTextContent(/^Teams$/);
    expect(club.getByText('Saved riders')).toHaveTextContent(/^Saved riders$/);
  });

  it('has no saved riders row without a club', async () => {
    mount({ roles: ['Trainer'], clubName: null });
    await section('My club').findByRole('link', { name: /Teams/ });
    expect(section('My club').queryByText('Saved riders')).not.toBeInTheDocument();
  });

  it('expands saved riders inline with their ponies and a link to dec forms', async () => {
    mount({ competition: true });
    const club = section('My club');
    await club.findAllByText('3');
    const toggle = club.getByRole('button', { name: /Saved riders/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = club.getByRole('list', { name: 'Saved riders list' });
    expect(within(list).getByText('Mia Clarke')).toBeInTheDocument();
    expect(within(list).getByText('Bramble')).toBeInTheDocument();
    expect(within(list).getByText('Leo Patel')).toBeInTheDocument();
    expect(within(list).getByText('Starlight')).toBeInTheDocument();
    expect(within(list).getByText('Zoe Evans')).toBeInTheDocument();
    expect(club.getByRole('link', { name: /Manage on dec forms/ })).toHaveAttribute('href', '/declarations');
  });

  it('is hidden for a member with no club and no teams', async () => {
    responses['/trainer/my-teams'] = [];
    mount({ roles: ['Member'], clubName: null });
    await screen.findByRole('region', { name: 'Account' });
    expect(screen.queryByRole('region', { name: 'My club' })).not.toBeInTheDocument();
  });

  it('appears for a member once they have a team', async () => {
    mount({ roles: ['Member'], clubName: null });
    expect(await screen.findByRole('region', { name: 'My club' })).toBeInTheDocument();
  });

  it('shows an admin dec forms but not a teams row when they have no teams', async () => {
    responses['/trainer/my-teams'] = [];
    mount({ roles: ['Admin'], clubName: null });
    const club = section('My club');
    expect(club.getByRole('link', { name: /Dec forms/ })).toBeInTheDocument();
    expect(club.queryByRole('link', { name: /Teams/ })).not.toBeInTheDocument();
  });
});

describe('ProfilePage: account', () => {
  it('has a notifications switch that turns notifications on', async () => {
    mount();
    const toggle = section('Account').getByRole('switch', { name: 'Notifications' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it('turns them off again when they are on', async () => {
    vi.mocked(useTeamNotifications).mockReturnValue({ enabled: true, setEnabled, permission: 'granted' });
    mount();
    const toggle = section('Account').getByRole('switch', { name: 'Notifications' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it.each(['denied', 'unsupported'] as const)('disables the switch when the browser says %s', (permission) => {
    vi.mocked(useTeamNotifications).mockReturnValue({ enabled: false, setEnabled, permission });
    mount();
    expect(section('Account').getByRole('switch', { name: 'Notifications' })).toBeDisabled();
  });

  it('keeps the account pages that used to be in the menu', () => {
    mount();
    const account = section('Account');
    expect(account.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['My account', '/me/account'], ['My signups', '/me/signups'], ['My items for sale', '/me/catalogue'], ['Orders & sales', '/me/orders'],
    ]);
  });

  it('leaves out my signups for an admin', () => {
    mount({ roles: ['Admin'] });
    expect(section('Account').queryByRole('link', { name: /My signups/ })).not.toBeInTheDocument();
  });

  it('signs out and goes home', async () => {
    mount();
    await userEvent.click(section('Account').getByRole('button', { name: 'Sign out' }));
    expect(localStorage.getItem('mg.auth')).toBeNull();
    expect(screen.getByText('Home page')).toBeInTheDocument();
  });
});

describe('ProfilePage: needs you', () => {
  it('is hidden when nothing needs the person', () => {
    mount({ roles: ['Trainer'] });
    expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument();
  });

  it('shows an admin the trainer requests, with the count in the heading', async () => {
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    expect(await needs.findByText('Sam Lee')).toBeInTheDocument();
    expect(needs.getByText('Priya Shah')).toBeInTheDocument();
    expect(needs.getAllByText('Wants to join as a trainer')).toHaveLength(2);
    expect(needs.getByText('2', { selector: 'span' })).toBeInTheDocument();
    expect(needs.getByText('PS')).toBeInTheDocument();
    expect(needs.getAllByRole('button', { name: 'Approve' })).toHaveLength(2);
  });

  it('approves a request, and the card goes', async () => {
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    await needs.findByText('Sam Lee');
    await userEvent.click(needs.getAllByRole('button', { name: 'Approve' })[0]);
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r1/approve');
    expect(await needs.findByText('Priya Shah')).toBeInTheDocument();
    expect(needs.queryByText('Sam Lee')).not.toBeInTheDocument();
    expect(needs.getByText('1', { selector: 'span' })).toBeInTheDocument();
  });

  it('declines a request, and the section goes with the last card', async () => {
    responses['/admin/trainer-requests'] = [requests[1]];
    const confirm = autoConfirm(true);
    mount({ roles: ['Admin'] });
    await userEvent.click((await needsSection()).getByRole('button', { name: 'Decline' }));
    expect(confirm).toHaveBeenCalledWith('Decline the request from Priya Shah? Their account will stay a member.');
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r2/decline');
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument());
  });

  it('keeps the card and says so under it when the server refuses', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('conflict'));
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    await userEvent.click(needs.getAllByRole('button', { name: 'Approve' })[0]);
    expect(await needs.findByRole('alert')).toHaveTextContent('Could not approve this request. Check your connection and try again.');
    expect(needs.getByText('Sam Lee')).toBeInTheDocument();
  });

  it("shows the server's own words when it refuses", async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { message: 'Could not approve this request. Refresh the list and try again.' } } });
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    await userEvent.click(needs.getAllByRole('button', { name: 'Approve' })[0]);
    expect(await needs.findByRole('alert')).toHaveTextContent('Refresh the list and try again.');
  });

  it('lets an admin approve or decline with no edit mode to switch on', async () => {
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    const approve = needs.getAllByRole('button', { name: 'Approve' })[0];
    expect(approve).toBeEnabled();
    expect(needs.getAllByRole('button', { name: 'Decline' })[0]).toBeEnabled();
    await userEvent.click(approve);
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r1/approve');
  });

  it('does not ask a trainer or a member for join requests', () => {
    mount({ roles: ['Trainer'] });
    expect(api.get).not.toHaveBeenCalledWith('/admin/trainer-requests');
  });

  it('shows a team manager their club\'s trainer requests, and lets them answer', async () => {
    mount({ roles: ['Manager'] });
    const needs = await needsSection();
    await needs.findByText('Sam Lee');
    expect(api.get).toHaveBeenCalledWith('/admin/trainer-requests');
    const approve = needs.getAllByRole('button', { name: 'Approve' })[0];
    expect(approve).toBeEnabled();
    await userEvent.click(approve);
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r1/approve');
  });

  it('says when somebody wants to be a team manager', async () => {
    responses['/admin/trainer-requests'] = [{ ...requests[0], requestedRole: 'Manager' }, { ...requests[1], requestedRole: 'Trainer' }];
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    expect(await needs.findByText('Wants to join as a team manager')).toBeInTheDocument();
    expect(needs.getByText('Wants to join as a trainer')).toBeInTheDocument();
  });

  it('asks for the dec forms that are still missing, linking to the form for that team', async () => {
    responses['/trainer/my-teams'] = [
      team(1, { competitionId: 4, displayName: 'Stockport C', needsDeclaration: true }),
      team(2, { competitionId: 4, displayName: 'Stockport D', needsDeclaration: false }),
      team(3, { competitionId: 9, needsDeclaration: null }),
    ];
    mount({ roles: ['Trainer'] });
    const needs = await needsSection();
    const row = needs.getByRole('link', { name: /Dec form needed: Stockport C/ });
    expect(row).toHaveAttribute('href', '/competitions/4/declarations?team=1');
    expect(needs.queryByText(/Stockport D/)).not.toBeInTheDocument();
    expect(needs.getByText('1', { selector: 'span' })).toBeInTheDocument();
  });

  it('counts approvals and missing dec forms together', async () => {
    responses['/trainer/my-teams'] = [team(1, { competitionId: 4, needsDeclaration: true })];
    mount({ roles: ['Manager'] });
    const needs = await needsSection();
    await needs.findByText('Sam Lee');
    expect(needs.getByText('3', { selector: 'span' })).toBeInTheDocument();
  });
});

describe('ProfilePage: the dashboard', () => {
  it('gives an admin quick actions, today’s events and the site admin sections on one page', async () => {
    responses['/competitions/picker'] = { items: [{ id: 4, name: 'Spring Games', startDate: new Date().toISOString(), endDate: null, icon: 'flag' }], hasMore: false };
    mount({ roles: ['Admin'] });
    expect(screen.getByRole('heading', { name: 'Site admin' })).toBeInTheDocument();
    const quick = section('Quick actions');
    expect(quick.getByRole('link', { name: /Create competition/ })).toHaveAttribute('href', '/admin/competitions/new');
    expect(await quick.findByRole('link', { name: /Score now/ })).toHaveAttribute('href', '/competitions/4/scoring');
    expect(quick.getByRole('link', { name: /Rules library/ })).toHaveAttribute('href', '/admin/rules');
    expect(await section('Today’s events').findByRole('link', { name: 'Jump in to Spring Games' })).toHaveAttribute('href', '/competitions/4');
    expect(screen.getByRole('region', { name: 'My club' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('gives a trainer Create competition but no site admin or events list', () => {
    mount({ roles: ['Trainer'] });
    expect(screen.queryByRole('heading', { name: 'Site admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Today’s events' })).not.toBeInTheDocument();
    expect(section('Quick actions').getByRole('link', { name: /Create competition/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rules library/ })).not.toBeInTheDocument();
  });

  it('gives a plain member neither', () => {
    mount({ roles: ['Member'] });
    expect(screen.queryByRole('region', { name: 'Quick actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Site admin' })).not.toBeInTheDocument();
  });
});
