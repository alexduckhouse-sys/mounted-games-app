import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { competition, heat, race, session, team } from '../test/factories';
import { CompactPageBarProvider, useCompactPageBarState } from '../components/CompactPageBarContext';
import { ProfilePage } from './ProfilePage';
import { NeedsYouProvider } from './profile/NeedsYouProvider';

import { autoConfirm } from '../test/confirm';
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

interface Options {
  roles?: string[];
  fullName?: string;
  clubName?: string | null;
  competition?: boolean;
}

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

function HeaderProbe() {
  const { header } = useCompactPageBarState();
  return <span data-testid="header-title">{header?.title ?? 'none'}</span>;
}

const today = new Date();
const at = (h: number, m: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m).toISOString();
const pickerItem = (id: number, extra: Record<string, unknown> = {}) => ({ id, name: `Event ${id}`, startDate: at(9, 0), endDate: null, icon: 'flag', ...extra });
const dueEntry = { id: 31, competitionId: 11, competitionName: 'Spring Open', competitionStart: at(9, 0), competitionSectionId: 1, sectionName: 'Under 15 Pairs', fullName: 'Sophie Hart', amountMinor: 4000, status: 0, createdAt: '2026-10-01T00:00:00Z' };

beforeEach(() => {
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
    '/me/signups': [],
    '/commerce/catalogue': [],
    '/competitions/picker': { items: [], hasMore: false },
  };
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url in responses) return { data: responses[url] };
    throw new Error(`unexpected ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: {} });
});

const section = (name: string) => within(screen.getByRole('region', { name }));
const needsSection = async () => within(await screen.findByRole('region', { name: 'Needs you' }));

describe('ProfilePage: title and loading', () => {
  it('puts the page’s title in the top bar', () => {
    const view = render(
      <MemoryRouter initialEntries={['/me']}>
        <AuthProvider><CurrentCompetitionProvider><NeedsYouProvider><CompactPageBarProvider>
          <Routes><Route path="/me" element={<ProfilePage />} /></Routes>
          <HeaderProbe />
        </CompactPageBarProvider></NeedsYouProvider></CurrentCompetitionProvider></AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('header-title')).toHaveTextContent('Me');
    expect(view.container).toBeTruthy();
  });

  it('holds "Needs you" back until the requests behind it have answered, then shows it with full-size buttons', async () => {
    mount({ roles: ['Admin'] });
    expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument();
    const needs = await needsSection();
    expect(needs.getByRole('button', { name: 'Approve Sam Lee' })).toHaveClass('sp-pill-tall');
    expect(needs.getByRole('button', { name: 'Decline Sam Lee' })).toHaveClass('sp-red-tall');
  });
});

describe('ProfilePage: header', () => {
  it('shows who the person is: initials, name, role and club', () => {
    mount({ roles: ['Manager'] });
    expect(screen.getByRole('heading', { name: 'Alex Morgan' })).toBeInTheDocument();
    expect(screen.getByText('AM')).toBeInTheDocument();
    expect(screen.getByText('Team manager · Stockport PC')).toBeInTheDocument();
  });

  it('uses the email when there is no name, and leaves the club out when there is none', () => {
    mount({ roles: ['Member'], fullName: '', clubName: null });
    expect(screen.getByRole('heading', { name: 'alex@example.com' })).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.queryByText(/Stockport PC/)).not.toBeInTheDocument();
  });

  it('has an Edit pill that opens the account details', () => {
    mount();
    const edit = screen.getByRole('link', { name: 'Edit your account details' });
    expect(edit).toHaveAttribute('href', '/me/account');
    expect(edit).toHaveTextContent('Edit');
  });

  it('has no big quick action buttons, no notifications switch and no site admin block left on it', async () => {
    mount({ roles: ['Admin'] });
    await screen.findByRole('region', { name: 'Account' });
    expect(screen.queryByRole('region', { name: 'Quick actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText(/Email opt-ins/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Site admin' })).not.toBeInTheDocument();
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

  it('gives a team manager and a trainer a Payouts row in My club', async () => {
    mount({ roles: ['Manager'] });
    expect(await section('My club').findByRole('link', { name: /Payouts/ })).toHaveAttribute('href', '/me/payouts');
  });

  it('gives a trainer a Payouts row in My club without a Members row', async () => {
    mount({ roles: ['Trainer'] });
    expect(await section('My club').findByRole('link', { name: /Payouts/ })).toHaveAttribute('href', '/me/payouts');
    expect(section('My club').queryByRole('link', { name: /Members/ })).not.toBeInTheDocument();
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
    expect(club.getByRole('link', { name: /Manage on dec forms/ })).toHaveClass('min-h-11');
    await userEvent.click(toggle);
    // It stays for the length of the close, then goes.
    expect(club.getByRole('list', { name: 'Saved riders list' }).closest('.sp-reveal')).toHaveAttribute('data-open', 'false');
    await waitFor(() => expect(club.queryByRole('list', { name: 'Saved riders list' })).not.toBeInTheDocument());
  });

  it('says so when there are no saved riders', async () => {
    responses['/clubs/7/saved-riders'] = [];
    mount();
    const club = section('My club');
    await userEvent.click(await club.findByRole('button', { name: /Saved riders/ }));
    expect(club.getByText('No saved riders yet.')).toBeInTheDocument();
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

describe('ProfilePage: shop and account', () => {
  it('has Things I sell, with how many are on sale, Orders and sales, and personal Payouts', async () => {
    responses['/commerce/catalogue'] = [{ id: 1, isActive: true }, { id: 2, isActive: true }, { id: 3, isActive: false }];
    mount();
    const shop = section('Shop');
    expect(shop.getByRole('link', { name: /Things I sell/ })).toHaveAttribute('href', '/me/catalogue');
    expect(await shop.findByText('2')).toBeInTheDocument();
    expect(shop.getByRole('link', { name: 'Orders and sales' })).toHaveAttribute('href', '/me/orders');
    expect(shop.getByRole('link', { name: /Payouts/ })).toHaveAttribute('href', '/me/payouts?scope=personal');
  });

  it('has My entries (with a count), My account and Settings, then Sign out', async () => {
    responses['/me/signups'] = [{ ...dueEntry }, { ...dueEntry, id: 32, status: 1 }];
    mount();
    const account = section('Account');
    expect(account.getByRole('link', { name: /My entries/ })).toHaveAttribute('href', '/me/signups');
    expect(await account.findByText('2')).toBeInTheDocument();
    expect(account.getByRole('link', { name: 'My account' })).toHaveAttribute('href', '/me/account');
    expect(account.getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/settings');
    // Sign out is its own full-width pill below the lists, not a row inside Account.
    expect(account.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut).toHaveClass('kit-pill', 'sp-signout');
    expect(signOut.closest('.sp-card')).toBeNull();
  });

  it('leaves out my entries for an admin', () => {
    mount({ roles: ['Admin'] });
    expect(section('Account').queryByRole('link', { name: /My entries/ })).not.toBeInTheDocument();
  });

  it('signs out and goes home', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(localStorage.getItem('mg.auth')).toBeNull();
    expect(screen.getByText('Home page')).toBeInTheDocument();
  });
});

describe('ProfilePage: needs you', () => {
  it('is hidden when nothing needs the person', () => {
    mount({ roles: ['Trainer'] });
    expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument();
  });

  it('shows an admin the trainer requests, with the count in the heading and the actions on the row', async () => {
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    expect(await needs.findByText('Sam Lee', { selector: '.sp-t1' })).toBeInTheDocument();
    expect(needs.getByText('Priya Shah', { selector: '.sp-t1' })).toBeInTheDocument();
    expect(needs.getAllByText('Wants to join as a trainer')).toHaveLength(2);
    expect(needs.getByText('2', { selector: 'small' })).toBeInTheDocument();
    expect(needs.getByRole('button', { name: 'Approve Sam Lee' })).toHaveClass('sp-pill-fill');
    // Decline is red text, not a pill.
    expect(needs.getByRole('button', { name: 'Decline Sam Lee' })).toHaveClass('sp-red');
  });

  it('approves a request, and the row goes', async () => {
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    await needs.findByText('Sam Lee', { selector: '.sp-t1' });
    await userEvent.click(needs.getByRole('button', { name: 'Approve Sam Lee' }));
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r1/approve');
    expect(await needs.findByText('Priya Shah', { selector: '.sp-t1' })).toBeInTheDocument();
    expect(needs.queryByText('Sam Lee', { selector: '.sp-t1' })).not.toBeInTheDocument();
    expect(needs.getByText('1', { selector: 'small' })).toBeInTheDocument();
  });

  it('declines a request after asking, and the section goes with the last row', async () => {
    responses['/admin/trainer-requests'] = [requests[1]];
    const confirm = autoConfirm(true);
    mount({ roles: ['Admin'] });
    await userEvent.click((await needsSection()).getByRole('button', { name: 'Decline Priya Shah' }));
    expect(confirm).toHaveBeenCalledWith('Their account stays a member.');
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r2/decline');
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument());
  });

  it('keeps the row when the person says no to declining', async () => {
    autoConfirm(false);
    mount({ roles: ['Admin'] });
    await userEvent.click((await needsSection()).getByRole('button', { name: 'Decline Sam Lee' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText('Sam Lee', { selector: '.sp-t1' })).toBeInTheDocument();
  });

  it('keeps the row and says so under it when the server refuses', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('conflict'));
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    await userEvent.click(await needs.findByRole('button', { name: 'Approve Sam Lee' }));
    expect(await needs.findByRole('alert')).toHaveTextContent('Could not approve this request. Check your connection and try again.');
    expect(needs.getByText('Sam Lee')).toBeInTheDocument();
  });

  it("shows the server's own words when it refuses", async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { message: 'Could not approve this request. Refresh the list and try again.' } } });
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    await userEvent.click(await needs.findByRole('button', { name: 'Approve Sam Lee' }));
    expect(await needs.findByRole('alert')).toHaveTextContent('Refresh the list and try again.');
  });

  it('does not ask a trainer or a member for join requests', () => {
    mount({ roles: ['Trainer'] });
    expect(api.get).not.toHaveBeenCalledWith('/admin/trainer-requests');
  });

  it('shows a team manager their club\'s trainer requests, and lets them answer', async () => {
    mount({ roles: ['Manager'] });
    const needs = await needsSection();
    await needs.findByText('Sam Lee', { selector: '.sp-t1' });
    expect(api.get).toHaveBeenCalledWith('/admin/trainer-requests');
    await userEvent.click(needs.getByRole('button', { name: 'Approve Sam Lee' }));
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r1/approve');
  });

  it('says when somebody wants to be a team manager', async () => {
    responses['/admin/trainer-requests'] = [{ ...requests[0], requestedRole: 'Manager' }, { ...requests[1], requestedRole: 'Trainer' }];
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    expect(await needs.findByText('Wants to join as a team manager')).toBeInTheDocument();
    expect(needs.getByText('Wants to join as a trainer')).toBeInTheDocument();
  });

  it('asks for the dec forms that are still missing, with Fill in on the row', async () => {
    responses['/trainer/my-teams'] = [
      team(1, { competitionId: 4, displayName: 'Stockport C', needsDeclaration: true }),
      team(2, { competitionId: 4, displayName: 'Stockport D', needsDeclaration: false }),
      team(3, { competitionId: 9, needsDeclaration: null }),
    ];
    mount({ roles: ['Trainer'] });
    const needs = await needsSection();
    expect(needs.getByText('Dec form to send')).toBeInTheDocument();
    expect(needs.getByRole('link', { name: /Fill in.*Stockport C/ })).toHaveAttribute('href', '/competitions/4/declarations?team=1');
    expect(needs.queryByText(/Stockport D/)).not.toBeInTheDocument();
    expect(needs.getByText('1', { selector: 'small' })).toBeInTheDocument();
  });

  it('counts approvals and missing dec forms together', async () => {
    responses['/trainer/my-teams'] = [team(1, { competitionId: 4, needsDeclaration: true })];
    mount({ roles: ['Manager'] });
    const needs = await needsSection();
    await needs.findByText('Sam Lee', { selector: '.sp-t1' });
    expect(needs.getByText('3', { selector: 'small' })).toBeInTheDocument();
  });

  it('asks a rider to pay for an entry that is not paid, with How to pay on the row', async () => {
    responses['/me/signups'] = [dueEntry, { ...dueEntry, id: 32, status: 1 }, { ...dueEntry, id: 33, isWithdrawn: true }, { ...dueEntry, id: 34, isWaitlist: true }];
    mount({ roles: ['Member'], clubName: null });
    const needs = await needsSection();
    expect(await needs.findByText('Pay for your entry')).toBeInTheDocument();
    expect(needs.getByText('£40.00')).toBeInTheDocument();
    expect(needs.getByText('Spring Open · Under 15 Pairs')).toBeInTheDocument();
    expect(needs.getByRole('link', { name: /How to pay/ })).toHaveAttribute('href', '/competitions/11/details');
    expect(needs.getAllByRole('link')).toHaveLength(1);
  });

  it('tells an organiser about unpaid entries, flagged dec forms and payouts that are not ready', async () => {
    responses['/competitions/picker'] = { items: [pickerItem(4)], hasMore: false };
    responses['/competitions/4/signups'] = [{ status: 0 }, { status: 1 }, { status: 0 }];
    responses['/competitions/4/dec-form-flags'] = [{ teamId: 3 }];
    responses['/clubs/7/payouts/summary'] = { ready: false };
    mount({ roles: ['Admin'] });
    const needs = await needsSection();
    expect(await needs.findByText('Entries not paid')).toBeInTheDocument();
    expect(await needs.findByText('Dec form flagged')).toBeInTheDocument();
    expect(await needs.findByText('Payouts aren’t set up')).toBeInTheDocument();
    expect(needs.getByRole('link', { name: /Set up/ })).toHaveAttribute('href', '/me/payouts');
    expect(needs.getAllByRole('link', { name: /Open/ }).map((a) => a.getAttribute('href'))).toEqual(['/competitions/4/details', '/competitions/4/declarations']);
  });
});

describe('ProfilePage: organiser', () => {
  it('gives an admin Your competitions, Site admin and a grey Create a competition bar', async () => {
    responses['/competitions/picker'] = { items: [pickerItem(4), pickerItem(5)], hasMore: false };
    mount({ roles: ['Admin'] });
    const organiser = section('Organiser');
    expect(organiser.getByRole('link', { name: /Your competitions/ })).toHaveAttribute('href', '/admin/competitions');
    expect(await organiser.findByText('2 coming up')).toBeInTheDocument();
    expect(organiser.getByRole('link', { name: /Site admin/ })).toHaveAttribute('href', '/admin');
    const create = organiser.getByRole('link', { name: 'Create a competition' });
    expect(create).toHaveAttribute('href', '/admin/competitions/new');
    expect(create).toHaveClass('sp-add');
  });

  it('gives a trainer the card without Site admin, counting only the events they run', async () => {
    responses['/competitions/picker'] = { items: [pickerItem(4), pickerItem(5)], hasMore: false };
    responses['/competitions/access'] = [{ competitionId: 4, owner: true }];
    mount({ roles: ['Trainer'] });
    const organiser = section('Organiser');
    expect(organiser.queryByRole('link', { name: /Site admin/ })).not.toBeInTheDocument();
    expect(organiser.getByRole('link', { name: /Your competitions/ })).toHaveAttribute('href', '/events');
    expect(await organiser.findByText('1 coming up')).toBeInTheDocument();
    expect(organiser.getByRole('link', { name: 'Create a competition' })).toBeInTheDocument();
  });

  it('gives a plain member and a team manager no organiser card', () => {
    mount({ roles: ['Member'] });
    expect(screen.queryByRole('region', { name: 'Organiser' })).not.toBeInTheDocument();
  });
});

describe('ProfilePage: today', () => {
  it('shows the events running today, with a LIVE chip when a heat is on', async () => {
    responses['/competitions/picker'] = { items: [pickerItem(4, { name: 'Spring Games', live: { sectionName: 'Under 12', heatLabel: 'Heat 1', arenaName: 'Main Arena' } }), pickerItem(5, { name: 'Autumn Cup', location: 'Stoneleigh Park' })], hasMore: false };
    responses['/trainer/my-teams'] = [];
    mount({ roles: ['Member'], clubName: null });
    const todaySection = await screen.findByRole('region', { name: 'Today' });
    const live = within(todaySection).getByRole('link', { name: /Spring Games/ });
    expect(live).toHaveAttribute('href', '/competitions/4');
    expect(live).toHaveTextContent('Under 12 · Heat 1 · Main Arena on now');
    expect(within(live).getByText('LIVE')).toBeInTheDocument();
    expect(within(todaySection).getByRole('link', { name: /Autumn Cup/ })).toHaveTextContent('Stoneleigh Park');
  });

  it('shows the session, heat, lane and delay of my teams, below Needs you', async () => {
    responses['/trainer/my-teams'] = [team(1, { competitionId: 4, displayName: 'Example Club A', sectionName: 'Open', relationship: 'trainer' })];
    responses['/competitions/4'] = competition({ id: 4, startDate: at(9, 0), sessions: [session(1, {
      name: 'Open session', scheduledStart: at(9, 0), startedAt: at(9, 10), status: 1,
      heats: [heat(1, { label: 'Heat 1', entries: [{ id: 1, teamId: 1, teamName: 'Example Club A', laneIndex: 3 }], races: [race(1)] })],
    })] });
    responses['/declaration-forms'] = [];
    mount({ roles: ['Admin'] });
    const teamsToday = await screen.findByRole('region', { name: 'Your teams today' });
    expect(teamsToday).toHaveTextContent('09:10');
    expect(teamsToday).toHaveTextContent('Open session · Heat 1 · Lane 3 · +10 min');
    expect(within(teamsToday).getByRole('link')).toHaveAttribute('href', '/competitions/4/teams/1');
    const needs = await screen.findByRole('region', { name: 'Needs you' });
    expect(needs.compareDocumentPosition(teamsToday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});


describe('ProfilePage: incoming pair requests', () => {
  it('shows only active incoming pending requests and opens the existing response flow', async () => {
    const incoming = { ...dueEntry, status: 1, fullName: 'Example Entrant', competitionName: 'Example Games', pairRequestFromSignupId: 80, pairRequestFromName: 'Example Partner', pairRequestStatus: 'Pending' };
    responses['/me/signups'] = [incoming,
      { ...incoming, id: 32, pairRequestStatus: 'Accepted' },
      { ...incoming, id: 33, pairRequestFromSignupId: null, pairRequestToSignupId: 81 },
      { ...incoming, id: 34, isWithdrawn: true },
      { ...incoming, id: 35, status: 3 }];
    mount({ roles: ['Member'], clubName: null });
    const needs = await needsSection();
    expect(await needs.findByText('Pair request from Example Partner')).toBeInTheDocument();
    expect(needs.getByText('Example Games · Under 15 Pairs')).toBeInTheDocument();
    expect(needs.getByRole('link', { name: /Review: Pair request/ })).toHaveAttribute('href', '/me/signups');
    expect(needs.getAllByRole('link')).toHaveLength(1);
    expect(needs.getByText('1', { selector: 'small' })).toBeInTheDocument();
  });

  it('counts a pair request alongside an entry still to pay', async () => {
    responses['/me/signups'] = [{ ...dueEntry, fullName: 'Example Entrant', pairRequestFromSignupId: 80, pairRequestStatus: 'Pending' }];
    mount({ roles: ['Member'], clubName: null });
    const needs = await needsSection();
    expect(await needs.findByText('Pair request from another rider')).toBeInTheDocument();
    expect(needs.getByText('Pay for your entry')).toBeInTheDocument();
    expect(needs.getByText('2', { selector: 'small' })).toBeInTheDocument();
  });
});
