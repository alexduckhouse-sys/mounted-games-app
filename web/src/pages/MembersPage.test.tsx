import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import type { ClubMember, ClubMembers } from '../types';
import { MembersPage } from './MembersPage';
import { NeedsYouProvider } from './profile/NeedsYouProvider';

import { autoConfirm } from '../test/confirm';
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const person = (userId: string, fullName: string, role: ClubMember['role'], extra: Partial<ClubMember> = {}): ClubMember =>
  ({ userId, fullName, role, teams: [], awaitingAdmin: false, ...extra });

const request = { userId: 'r1', fullName: 'Sam Lee', email: 'sam@example.com', clubName: 'Stockport PC', requestedAt: '2026-10-20T09:00:00Z', requestedRole: 'Trainer' as const };

const club = (): ClubMembers => ({
  clubId: 7, clubName: 'Stockport PC',
  members: [
    person('me', 'Alex Morgan', 'Manager'),
    person('jh', 'Jo Hughes', 'Trainer', { teams: ['Stockport A', 'Stockport B'] }),
    person('rk', 'Rob Khan', 'Trainer', { teams: ['Stockport C'] }),
    person('kh', 'Kerry Hall', 'Member'),
    person('md', 'Mel Dunn', 'Member'),
  ],
  pending: [request, { ...request, userId: 'r2', fullName: 'Priya Shah', email: 'priya@example.com' }],
});

let members: ClubMembers;

function mount(options: { roles?: string[]; clubId?: number | null } = {}) {
  const roles = options.roles ?? ['Manager'];
  const auth: StoredAuth = {
    token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id: 'me', email: 'alex@example.com', fullName: 'Alex Morgan', clubId: options.clubId === undefined ? 7 : options.clubId, clubName: options.clubId === null ? null : 'Stockport PC', roles },
  };
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  return render(
    <MemoryRouter initialEntries={['/me/members']}>
      <AuthProvider><NeedsYouProvider>
        <Routes>
          <Route path="/me/members" element={<MembersPage />} />
          <Route path="/me" element={<p>Profile page</p>} />
        </Routes>
      </NeedsYouProvider></AuthProvider>
    </MemoryRouter>,
  );
}

const group = (name: string) => within(screen.getByRole('region', { name }));
const waitingFor = async () => within(await screen.findByRole('region', { name: 'Waiting for you' }));
const more = (name: string) => screen.getByRole('button', { name: `More for ${name}` });
const sheet = () => within(screen.getByRole('dialog'));

beforeEach(() => {
  members = club();
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/clubs/7/members') return { data: members };
    if (url === '/clubs/9/members') return { data: { clubId: 9, clubName: 'Wirral PC', members: [person('w1', 'Wendy Ross', 'Manager'), person('w2', 'Will Ash', 'Trainer')], pending: [] } };
    if (url === '/clubs') return { data: [{ id: 7, name: 'Stockport PC' }, { id: 9, name: 'Wirral PC' }] };
    if (url === '/admin/trainer-requests') return { data: members.pending };
    if (url === '/trainer/my-teams') return { data: [] };
    if (url === '/auth/me') return { data: {} };
    if (url === '/competitions/access') return { data: [] };
    throw new Error(`unexpected ${url}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  vi.mocked(api.put).mockResolvedValue({ data: { role: 'Trainer', awaitingAdmin: false } });
  vi.mocked(api.delete).mockResolvedValue({ data: {} });
  autoConfirm(true);
});

describe('MembersPage: the list', () => {
  it('shows everyone by role, with counts and a line for each trainer\'s teams', async () => {
    mount();
    expect(await screen.findByText('Jo Hughes')).toBeInTheDocument();
    expect(group('Club managers').getByText('Alex Morgan')).toBeInTheDocument();
    expect(group('Trainers').getByText('Stockport A, Stockport B')).toBeInTheDocument();
    expect(group('Trainers').getByText('Stockport C')).toBeInTheDocument();
    expect(group('Members').getByText('Mel Dunn')).toBeInTheDocument();
    expect(group('Members').getByText('2', { selector: 'small' })).toBeInTheDocument();
    expect(group('Members').getByText('KH')).toBeInTheDocument();
  });

  it('marks your own row "You" and gives it no menu', async () => {
    mount();
    await screen.findByText('Jo Hughes');
    expect(group('Club managers').getByText('You')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More for Alex Morgan' })).not.toBeInTheDocument();
    expect(more('Jo Hughes')).toBeInTheDocument();
  });

  it('has no club picker for a club manager', async () => {
    mount();
    await screen.findByText('Jo Hughes');
    expect(screen.queryByRole('combobox', { name: /Club/ })).not.toBeInTheDocument();
  });

  it('leaves out groups with nobody in them', async () => {
    members.members = [person('me', 'Alex Morgan', 'Manager')];
    members.pending = [];
    mount();
    await screen.findByText('Alex Morgan');
    expect(screen.queryByRole('region', { name: 'Trainers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Members' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).not.toBeInTheDocument();
  });

  it('says so when the list cannot be loaded, or is not a list', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/clubs/7/members') throw new Error('offline');
      return { data: url === '/competitions/access' ? [] : {} };
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the members. Check your signal and try again.');
  });

  it('tries again from the problem strip', async () => {
    let fail = true;
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/clubs/7/members') {
        if (fail) throw new Error('offline');
        return { data: members };
      }
      return { data: url === '/competitions/access' ? [] : {} };
    });
    mount();
    await screen.findByRole('alert');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Alex Morgan')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats a page served instead of the list as a failure', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/clubs/7/members') return { data: '<html></html>' };
      return { data: url === '/competitions/access' ? [] : {} };
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the members. Check your signal and try again.');
  });
});

describe('MembersPage: waiting for you', () => {
  it('lists the join requests with a count, Approve as a pill and Decline as red text', async () => {
    mount();
    const waiting = await waitingFor();
    expect(await waiting.findByText('Sam Lee')).toBeInTheDocument();
    expect(waiting.getByText('Priya Shah')).toBeInTheDocument();
    expect(waiting.getAllByText('Wants to join as a trainer')).toHaveLength(2);
    expect(waiting.getByText('2', { selector: 'small' })).toBeInTheDocument();
    expect(waiting.getByText('SL')).toBeInTheDocument();
    expect(waiting.getByRole('button', { name: 'Approve Sam Lee' })).toHaveClass('kit-pill-fill');
    expect(waiting.getByRole('button', { name: 'Decline Sam Lee' })).toHaveClass('kit-redtext');
  });

  it('says when somebody asked to be a club manager', async () => {
    members.pending = [{ ...request, requestedRole: 'Manager' }];
    mount({ roles: ['Admin'] });
    expect(await screen.findByText('Wants to join as a club manager')).toBeInTheDocument();
  });

  it('approves one, then shows the club again so they appear in their group', async () => {
    vi.mocked(api.post).mockImplementation(async () => {
      members = { ...members, pending: [members.pending[1]], members: [...members.members, person('r1', 'Sam Lee', 'Trainer')] };
      return { data: {} };
    });
    const user = userEvent.setup();
    mount();
    const waiting = await waitingFor();
    await user.click(await waiting.findByRole('button', { name: 'Approve Sam Lee' }));
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r1/approve');
    await waitFor(() => expect(group('Trainers').getByText('Sam Lee')).toBeInTheDocument());
    expect(group('Waiting for you').getAllByText('Priya Shah')).toHaveLength(1);
    expect(group('Waiting for you').queryByText('Sam Lee')).not.toBeInTheDocument();
  });

  it('declines one', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await (await waitingFor()).findByRole('button', { name: 'Decline Priya Shah' }));
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r2/decline');
  });

  it('asks before declining, and does nothing if you cancel', async () => {
    const asked = autoConfirm(false);
    const user = userEvent.setup();
    mount();
    await user.click(await (await waitingFor()).findByRole('button', { name: 'Decline Priya Shah' }));
    await waitFor(() => expect(asked.titles).toEqual(['Decline this request?']));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('switches both buttons off while a request is being saved', async () => {
    let finish: () => void = () => {};
    vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { finish = () => resolve({ data: {} }); }));
    const user = userEvent.setup();
    mount();
    await user.click(await (await waitingFor()).findByRole('button', { name: 'Approve Priya Shah' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Decline Sam Lee' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Approve Sam Lee' })).toBeDisabled();
    finish();
  });

  it('says so when the server refuses', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('no'));
    const user = userEvent.setup();
    mount();
    await user.click(await (await waitingFor()).findByRole('button', { name: 'Approve Sam Lee' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not approve this request. Check your connection and try again.');
    expect(group('Waiting for you').getByText('Sam Lee')).toBeInTheDocument();
  });

  it('shows the server’s reason, such as an address that isn’t confirmed yet', async () => {
    const reason = 'This person hasn\'t confirmed their email address yet. Ask them to open the confirmation email (they can send it again from their profile), then try again.';
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { code: 'email_unconfirmed', message: reason } } });
    const user = userEvent.setup();
    mount();
    await user.click(await (await waitingFor()).findByRole('button', { name: 'Approve Sam Lee' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(reason);
  });
});

describe('MembersPage: a person\'s menu', () => {
  it('opens a sheet that lists the roles with theirs ticked, and Remove from club in red', async () => {
    const user = userEvent.setup();
    mount({ roles: ['Admin'] });
    await screen.findByText('Jo Hughes');
    await user.click(more('Jo Hughes'));
    expect(screen.getByRole('dialog', { name: 'Jo Hughes' })).toBeInTheDocument();
    expect(sheet().getAllByRole('radio').map((r) => r.textContent)).toEqual(['Club manager', 'Trainer', 'Member']);
    expect(sheet().getByRole('radio', { name: 'Trainer' })).toHaveAttribute('aria-checked', 'true');
    expect(sheet().getByRole('radio', { name: 'Member' })).toHaveAttribute('aria-checked', 'false');
    expect(sheet().getByRole('button', { name: 'Remove from club' })).toHaveClass('kit-redtext');
  });

  it('offers a club manager only Trainer and Member', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(more('Jo Hughes'));
    expect(sheet().getAllByRole('radio').map((r) => r.textContent)).toEqual(['Trainer', 'Member']);
  });

  it('moves a person to the group they are switched to', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { role: 'Member', awaitingAdmin: false } });
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(more('Jo Hughes'));
    await user.click(sheet().getByRole('radio', { name: 'Member' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/clubs/7/members/jh/role', { role: 'Member' }));
    await waitFor(() => expect(group('Members').getByText('Jo Hughes')).toBeInTheDocument());
    expect(group('Members').queryByText('Stockport A, Stockport B')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does nothing when the role chosen is the one they have', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(more('Jo Hughes'));
    await user.click(sheet().getByRole('radio', { name: 'Trainer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.put).not.toHaveBeenCalled();
  });

  it('keeps a trainer a trainer and says an admin has to approve when they are put up as a club manager', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { role: 'Trainer', awaitingAdmin: true } });
    const user = userEvent.setup();
    mount({ roles: ['Admin'] });
    await screen.findByText('Jo Hughes');
    await user.click(more('Jo Hughes'));
    await user.click(sheet().getByRole('radio', { name: 'Club manager' }));
    expect(await group('Trainers').findByText('Waiting for an admin to approve')).toBeInTheDocument();
    expect(group('Trainers').getByText('Jo Hughes')).toBeInTheDocument();
  });

  it('shows the API\'s reason when a role cannot be changed', async () => {
    vi.mocked(api.put).mockRejectedValue({ response: { status: 409, data: { message: 'Approve or decline their request first.' } } });
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(more('Jo Hughes'));
    await user.click(sheet().getByRole('radio', { name: 'Member' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Approve or decline their request first.');
    expect(group('Trainers').getByText('Jo Hughes')).toBeInTheDocument();
  });

  it('removes a person from the club after asking', async () => {
    const asked = autoConfirm(true);
    const user = userEvent.setup();
    mount();
    await screen.findByText('Kerry Hall');
    await user.click(more('Kerry Hall'));
    await user.click(sheet().getByRole('button', { name: 'Remove from club' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Kerry Hall stops being a member of Stockport PC.'));
    expect(api.delete).toHaveBeenCalledWith('/clubs/7/members/kh');
    await waitFor(() => expect(screen.queryByText('Kerry Hall')).not.toBeInTheDocument());
    expect(group('Members').getByText('Mel Dunn')).toBeInTheDocument();
  });

  it('keeps them when the question is answered no', async () => {
    autoConfirm(false);
    const user = userEvent.setup();
    mount();
    await screen.findByText('Kerry Hall');
    await user.click(more('Kerry Hall'));
    await user.click(sheet().getByRole('button', { name: 'Remove from club' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Kerry Hall' })).toBeInTheDocument();
    expect(group('Members').getByText('Kerry Hall')).toBeInTheDocument();
  });

  it('says so when they cannot be removed', async () => {
    vi.mocked(api.delete).mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    mount();
    await screen.findByText('Kerry Hall');
    await user.click(more('Kerry Hall'));
    await user.click(sheet().getByRole('button', { name: 'Remove from club' }));
    expect(await screen.findByText('Couldn’t remove them. Check your signal and try again.')).toBeInTheDocument();
    expect(group('Members').getByText('Kerry Hall')).toBeInTheDocument();
  });

  it('gives a club manager no menu for another club manager', async () => {
    members.members.push(person('b2', 'Bea Cole', 'Manager'));
    mount();
    await screen.findByText('Bea Cole');
    expect(screen.queryByRole('button', { name: 'More for Bea Cole' })).not.toBeInTheDocument();
  });
});

describe('MembersPage: an admin', () => {
  const chooseClub = async (name: string) => {
    await userEvent.click(await screen.findByRole('combobox', { name: /^Club/ }));
    await userEvent.click(await screen.findByRole('option', { name }));
  };

  it('chooses the club, and sees its people', async () => {
    mount({ roles: ['Admin'], clubId: null });
    await screen.findByRole('combobox', { name: 'Club Choose a club' });
    expect(screen.queryByRole('region', { name: 'Trainers' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/clubs'));
    await chooseClub('Wirral PC');
    expect(await screen.findByText('Will Ash')).toBeInTheDocument();
    await chooseClub('Choose a club');
    expect(screen.queryByText('Will Ash')).not.toBeInTheDocument();
  });

  it('opens club managers too', async () => {
    const user = userEvent.setup();
    mount({ roles: ['Admin'], clubId: null });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/clubs'));
    await chooseClub('Wirral PC');
    await user.click(await screen.findByRole('button', { name: 'More for Wendy Ross' }));
    expect(sheet().getAllByRole('radio').map((r) => r.textContent)).toEqual(['Club manager', 'Trainer', 'Member']);
  });

  it('lets an admin use the buttons straight away, with no edit mode to switch on', async () => {
    const user = userEvent.setup();
    mount({ roles: ['Admin'] });
    const waiting = await waitingFor();
    expect(await waiting.findByRole('button', { name: 'Approve Sam Lee' })).toBeEnabled();
    expect(waiting.getByRole('button', { name: 'Decline Sam Lee' })).toBeEnabled();
    await user.click(more('Jo Hughes'));
    expect(sheet().getByRole('radio', { name: 'Member' })).toBeEnabled();
    expect(sheet().getByRole('button', { name: 'Remove from club' })).toBeEnabled();
  });

  it('asks nothing until a club is chosen', async () => {
    mount({ roles: ['Admin'], clubId: null });
    await screen.findByRole('combobox', { name: /^Club/ });
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/clubs\/\d+\/members$/));
  });
});

describe('MembersPage: no one signed in', () => {
  it('explains when you are not in a club yet', () => {
    mount({ clubId: null });
    expect(screen.getByText(/not in a club yet/)).toBeInTheDocument();
  });

  it('renders nothing', () => {
    const { container } = render(<MemoryRouter><AuthProvider><MembersPage /></AuthProvider></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
