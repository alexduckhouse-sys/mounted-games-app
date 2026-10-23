import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import type { ClubMember, ClubMembers } from '../types';
import { MembersPage } from './MembersPage';
import { NeedsYouProvider } from './profile/NeedsYouProvider';

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

function mount(options: { roles?: string[]; clubId?: number | null; editMode?: boolean } = {}) {
  const roles = options.roles ?? ['Manager'];
  const auth: StoredAuth = {
    token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id: 'me', email: 'alex@example.com', fullName: 'Alex Morgan', clubId: options.clubId === undefined ? 7 : options.clubId, clubName: options.clubId === null ? null : 'Stockport PC', roles },
  };
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  if (options.editMode) localStorage.setItem('mg.adminEditorMode', '1');
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
const row = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

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
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('MembersPage: the list', () => {
  it('shows the club, then everyone by role with a line for each trainer\'s teams', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument();
    expect(await screen.findByText('Jo Hughes')).toBeInTheDocument();
    expect(screen.getAllByText('Stockport PC')).toHaveLength(1);
    expect(group('Team managers').getByText('Alex Morgan')).toBeInTheDocument();
    expect(group('Trainers').getByText('Stockport A, Stockport B')).toBeInTheDocument();
    expect(group('Trainers').getByText('Stockport C')).toBeInTheDocument();
    expect(group('Members').getByText('Mel Dunn')).toBeInTheDocument();
    expect(group('Members').getByText('2', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to my profile' })).toHaveAttribute('href', '/me');
  });

  it('marks your own row "You" and does not let you open it', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    const mine = row('Alex Morgan');
    expect(within(mine).getByText('You')).toBeInTheDocument();
    await user.click(mine);
    expect(screen.queryByRole('group', { name: /Role for/ })).not.toBeInTheDocument();
    expect(mine).not.toHaveAttribute('aria-expanded');
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the members. Try again.');
  });

  it('treats a page served instead of the list as a failure', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/clubs/7/members') return { data: '<html></html>' };
      return { data: url === '/competitions/access' ? [] : {} };
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the members. Try again.');
  });
});

describe('MembersPage: waiting for you', () => {
  it('lists the join requests with a count', async () => {
    mount();
    const waiting = await waitingFor();
    expect(await waiting.findByText('Sam Lee')).toBeInTheDocument();
    expect(waiting.getByText('Priya Shah')).toBeInTheDocument();
    expect(waiting.getAllByText('Wants to join as a trainer')).toHaveLength(2);
    expect(waiting.getByText('2', { selector: 'span' })).toBeInTheDocument();
    expect(waiting.getByText('SL')).toBeInTheDocument();
  });

  it('says when somebody asked to be a team manager', async () => {
    members.pending = [{ ...request, requestedRole: 'Manager' }];
    mount({ roles: ['Admin'], editMode: true });
    expect(await screen.findByText('Wants to join as a team manager')).toBeInTheDocument();
  });

  it('approves one, then shows the club again so they appear in their group', async () => {
    vi.mocked(api.post).mockImplementation(async () => {
      members = { ...members, pending: [members.pending[1]], members: [...members.members, person('r1', 'Sam Lee', 'Trainer')] };
      return { data: {} };
    });
    const user = userEvent.setup();
    mount();
    const waiting = await waitingFor();
    await user.click((await waiting.findAllByRole('button', { name: 'Approve' }))[0]);
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r1/approve');
    await waitFor(() => expect(group('Trainers').getByText('Sam Lee')).toBeInTheDocument());
    expect(group('Waiting for you').getAllByText('Priya Shah')).toHaveLength(1);
    expect(group('Waiting for you').queryByText('Sam Lee')).not.toBeInTheDocument();
  });

  it('declines one', async () => {
    const user = userEvent.setup();
    mount();
    await user.click((await (await waitingFor()).findAllByRole('button', { name: 'Decline' }))[1]);
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/r2/decline');
  });

  it('says so when the server refuses', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('no'));
    const user = userEvent.setup();
    mount();
    await user.click((await (await waitingFor()).findAllByRole('button', { name: 'Approve' }))[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update this request. Try again.');
    expect(group('Waiting for you').getByText('Sam Lee')).toBeInTheDocument();
  });
});

describe('MembersPage: a person\'s row', () => {
  it('opens inline with a three-way role switch and Remove from club', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(row('Jo Hughes'));
    const roles = screen.getByRole('group', { name: 'Role for Jo Hughes' });
    expect(within(roles).getAllByRole('button').map((b) => b.textContent)).toEqual(['Team manager', 'Trainer', 'Member']);
    expect(within(roles).getByRole('button', { name: 'Trainer' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Remove from club' })).toBeInTheDocument();
    await user.click(row('Jo Hughes'));
    expect(screen.queryByRole('group', { name: 'Role for Jo Hughes' })).not.toBeInTheDocument();
  });

  it('opens one row at a time', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(row('Jo Hughes'));
    await user.click(row('Kerry Hall'));
    expect(screen.queryByRole('group', { name: 'Role for Jo Hughes' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Role for Kerry Hall' })).toBeInTheDocument();
  });

  it('moves a person to the group they are switched to', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { role: 'Member', awaitingAdmin: false } });
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(row('Jo Hughes'));
    await user.click(within(screen.getByRole('group', { name: 'Role for Jo Hughes' })).getByRole('button', { name: 'Member' }));
    expect(api.put).toHaveBeenCalledWith('/clubs/7/members/jh/role', { role: 'Member' });
    await waitFor(() => expect(group('Members').getByText('Jo Hughes')).toBeInTheDocument());
    expect(group('Members').queryByText('Stockport A, Stockport B')).not.toBeInTheDocument();
  });

  it('does nothing when the role chosen is the one they have', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(row('Jo Hughes'));
    await user.click(within(screen.getByRole('group', { name: 'Role for Jo Hughes' })).getByRole('button', { name: 'Trainer' }));
    expect(api.put).not.toHaveBeenCalled();
  });

  it('keeps a trainer a trainer and says an admin has to approve when they are put up as a team manager', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { role: 'Trainer', awaitingAdmin: true } });
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(row('Jo Hughes'));
    await user.click(within(screen.getByRole('group', { name: 'Role for Jo Hughes' })).getByRole('button', { name: 'Team manager' }));
    expect(await group('Trainers').findByText('Waiting for an admin to approve')).toBeInTheDocument();
    expect(group('Trainers').getByText('Jo Hughes')).toBeInTheDocument();
  });

  it('shows the API\'s reason when a role cannot be changed', async () => {
    vi.mocked(api.put).mockRejectedValue({ response: { status: 409, data: { message: 'Approve or decline their request first.' } } });
    const user = userEvent.setup();
    mount();
    await screen.findByText('Jo Hughes');
    await user.click(row('Jo Hughes'));
    await user.click(within(screen.getByRole('group', { name: 'Role for Jo Hughes' })).getByRole('button', { name: 'Member' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Approve or decline their request first.');
    expect(group('Trainers').getByText('Jo Hughes')).toBeInTheDocument();
  });

  it('removes a person from the club after asking', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Kerry Hall');
    await user.click(row('Kerry Hall'));
    await user.click(screen.getByRole('button', { name: 'Remove from club' }));
    expect(window.confirm).toHaveBeenCalledWith('Remove Kerry Hall from Stockport PC?');
    expect(api.delete).toHaveBeenCalledWith('/clubs/7/members/kh');
    await waitFor(() => expect(screen.queryByText('Kerry Hall')).not.toBeInTheDocument());
    expect(group('Members').getByText('Mel Dunn')).toBeInTheDocument();
  });

  it('keeps them when the question is answered no', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const user = userEvent.setup();
    mount();
    await screen.findByText('Kerry Hall');
    await user.click(row('Kerry Hall'));
    await user.click(screen.getByRole('button', { name: 'Remove from club' }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Kerry Hall')).toBeInTheDocument();
  });

  it('says so when they cannot be removed', async () => {
    vi.mocked(api.delete).mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    mount();
    await screen.findByText('Kerry Hall');
    await user.click(row('Kerry Hall'));
    await user.click(screen.getByRole('button', { name: 'Remove from club' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove them. Try again.');
    expect(screen.getByText('Kerry Hall')).toBeInTheDocument();
  });

  it('does not let a team manager open another team manager', async () => {
    members.members.push(person('b2', 'Bea Cole', 'Manager'));
    mount();
    await screen.findByText('Bea Cole');
    expect(row('Bea Cole')).toBeDisabled();
  });
});

describe('MembersPage: an admin', () => {
  it('chooses the club, and sees its people', async () => {
    const user = userEvent.setup();
    mount({ roles: ['Admin'], clubId: null, editMode: true });
    const select = await screen.findByLabelText('Club');
    expect(screen.queryByRole('region', { name: 'Trainers' })).not.toBeInTheDocument();
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    await user.selectOptions(select, 'Wirral PC');
    expect(await screen.findByText('Will Ash')).toBeInTheDocument();
    expect(screen.getByText('Wirral PC', { selector: 'p' })).toBeInTheDocument();
    await user.selectOptions(select, '');
    expect(screen.queryByText('Will Ash')).not.toBeInTheDocument();
  });

  it('opens team managers too', async () => {
    const user = userEvent.setup();
    mount({ roles: ['Admin'], clubId: null, editMode: true });
    await screen.findByLabelText('Club');
    await waitFor(() => expect(within(screen.getByLabelText('Club')).getAllByRole('option')).toHaveLength(3));
    await user.selectOptions(screen.getByLabelText('Club'), 'Wirral PC');
    await user.click(await screen.findByRole('button', { name: /Wendy Ross/ }));
    expect(screen.getByRole('group', { name: 'Role for Wendy Ross' })).toBeInTheDocument();
  });

  it('keeps the buttons off until edit mode is on', async () => {
    const user = userEvent.setup();
    mount({ roles: ['Admin'], editMode: false });
    const waiting = await waitingFor();
    expect((await waiting.findAllByRole('button', { name: 'Approve' }))[0]).toBeDisabled();
    expect(waiting.getAllByRole('button', { name: 'Decline' })[0]).toBeDisabled();
    await user.click(row('Jo Hughes'));
    expect(within(screen.getByRole('group', { name: 'Role for Jo Hughes' })).getByRole('button', { name: 'Member' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove from club' })).toBeDisabled();
  });

  it('asks nothing until a club is chosen', async () => {
    mount({ roles: ['Admin'], clubId: null, editMode: true });
    await screen.findByLabelText('Club');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/clubs\/\d+\/members$/));
  });
});

describe('MembersPage: no one signed in', () => {
  it('renders nothing', () => {
    const { container } = render(<MemoryRouter><AuthProvider><MembersPage /></AuthProvider></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
