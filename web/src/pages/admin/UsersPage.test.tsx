import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { UsersPage } from './UsersPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const auth = vi.hoisted(() => ({ roles: ['Admin', 'MasterAdmin'] as string[] }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', roles: auth.roles }, hasRole: (role: string) => auth.roles.includes(role) }),
}));

const staff = (id: string, name: string, roles: string[], extra: Record<string, unknown> = {}) => ({ id, fullName: name, email: `${id}@example.com`, roles, lockedAt: null, createdAt: '2026-10-01T00:00:00Z', ...extra });
const invite = (id: number, email: string, extra: Record<string, unknown> = {}) => ({ id, email, access: 0, createdAt: '2026-10-20T10:00:00Z', expiresAt: '2026-10-27T10:00:00Z', lastSentAt: '2026-10-20T10:00:00Z', emailStatus: 1, sendCount: 1, isExpired: false, invitedByName: 'Me', ...extra });
const person = (id: string, name: string, roles: string[], extra: Record<string, unknown> = {}) => ({ id, fullName: name, email: `${id}@example.com`, clubId: null, clubName: null, roles, isLockedOut: false, createdAt: '2026-10-01T00:00:00Z', isLocked: false, isBlocked: false, ...extra });

function serve(data: { staff?: unknown[]; invites?: unknown[]; people?: unknown[] }) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/admin/staff-accounts') return { data: data.staff ?? [] } as never;
    if (url === '/admin/invites') return { data: data.invites ?? [] } as never;
    if (url === '/admin/users') return { data: data.people ?? [] } as never;
    return { data: [] } as never;
  });
}
const mount = () => render(<MemoryRouter><UsersPage /></MemoryRouter>);

describe('UsersPage', () => {
  beforeEach(() => {
    auth.roles = ['Admin', 'MasterAdmin'];
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    serve({
      staff: [staff('me', 'Demo Admin', ['Admin', 'MasterAdmin']), staff('a2', 'Site Sam', ['Admin']), staff('t1', 'Olly Organiser', ['Trainer']), staff('t2', 'Locked Lou', ['Trainer'], { lockedAt: '2026-10-22T10:00:00Z' }), staff('shared', 'Shared', ['Admin'], { email: 'admin@mg.local' })],
      invites: [invite(7, 'new@example.com')],
    });
  });

  it('shows the invite card, invites sent, admins and the search, with no subtitle', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Invite an admin' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(screen.queryByText(/Invite admins · lock accounts/)).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Admins' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Everyone else' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Invites sent' })).toBeInTheDocument();
    expect(await screen.findByText('Demo Admin (you)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Access: Organiser/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled();
  });

  it('sends an invite for an organiser or a site admin, then lists it', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: invite(9, 'ann@example.com', { access: 1 }) });
    mount();
    await user.type(await screen.findByPlaceholderText('name@example.com'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: /^Access: Organiser/ }));
    await user.click(screen.getByRole('option', { name: 'Site admin' }));
    expect(screen.getByText(/Site admins can open and change every competition/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(api.post).toHaveBeenCalledWith('/admin/invites', { email: 'ann@example.com', access: 1 });
    expect(await screen.findByText('ann@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('name@example.com')).toHaveValue('');
  });

  it('shows why an invite could not be sent', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { detail: 'That email already has an account.' } } });
    mount();
    await user.type(await screen.findByPlaceholderText('name@example.com'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That email already has an account.');
  });

  it('resends an invite, and cancels one after asking', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    vi.mocked(api.post).mockResolvedValue({ data: invite(7, 'new@example.com', { sendCount: 2, emailStatus: 3 }) });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Resend the invite to new@example.com' }));
    expect(api.post).toHaveBeenCalledWith('/admin/invites/7/resend');
    expect(await screen.findByText(/email sending is off/)).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Cancel the invite to new@example.com' });
    expect(cancel).toHaveClass('ops-danger-link');
    await user.click(cancel);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/invites/7'));
    await waitFor(() => expect(screen.queryByText('new@example.com')).not.toBeInTheDocument());
    expect(asked).toHaveBeenCalledOnce();
    asked.stop();
  });

  it('keeps an invite when cancelling is declined', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(false);
    mount();
    await user.click(await screen.findByRole('button', { name: 'Cancel the invite to new@example.com' }));
    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(api.delete).not.toHaveBeenCalled();
    asked.stop();
  });

  it('lets a master admin lock admins and organisers, but not themselves, a master or the shared sign-in', async () => {
    mount();
    expect(await screen.findByRole('button', { name: 'Lock Site Sam' })).toHaveClass('ops-danger-link');
    expect(screen.getByRole('button', { name: 'Lock Olly Organiser' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock Locked Lou' })).toHaveClass('rf-btn');
    expect(screen.queryByRole('button', { name: 'Lock Demo Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock Shared' })).not.toBeInTheDocument();
  });

  it('lets a site admin lock organisers only', async () => {
    auth.roles = ['Admin'];
    mount();
    expect(await screen.findByRole('button', { name: 'Lock Olly Organiser' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock Locked Lou' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock Site Sam' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Demo Admin$/ })).not.toBeInTheDocument();
  });

  it('locks after asking and unlocks straight away', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    mount();
    await user.click(await screen.findByRole('button', { name: 'Lock Olly Organiser' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/t1/account-lock'));
    expect(await screen.findByRole('button', { name: 'Unlock Olly Organiser' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unlock Locked Lou' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/users/t2/account-lock'));
    expect(await screen.findByRole('button', { name: 'Lock Locked Lou' })).toBeInTheDocument();
    expect(asked).toHaveBeenCalledOnce();
    asked.stop();
  });

  it('shows the refusal when a lock is not allowed', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    vi.mocked(api.post).mockRejectedValue({ response: { status: 403, data: { detail: 'Only a master admin can lock an admin account.' } } });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Lock Olly Organiser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a master admin can lock an admin account.');
    asked.stop();
  });

  it('searches everyone else, leaving staff to the list above, and offers Make admin to a master admin', async () => {
    const user = userEvent.setup();
    serve({ staff: [staff('t1', 'Olly Organiser', ['Trainer'])], people: [person('p1', 'Pat Rider', ['Rider']), person('t1', 'Olly Organiser', ['Trainer']), person('p2', 'Bad Bob', ['Member'], { isBlocked: true })] });
    mount();
    expect(screen.queryByLabelText('Matching accounts')).not.toBeInTheDocument();
    await user.type(await screen.findByRole('searchbox', { name: 'Search accounts' }), 'pat');
    const results = await screen.findByLabelText('Matching accounts');
    expect(await within(results).findByText('Pat Rider')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/admin/users', { params: { q: 'pat' } });
    expect(within(results).queryByText('Olly Organiser')).not.toBeInTheDocument();
    expect(within(results).getByRole('button', { name: 'Make Pat Rider an admin' })).toBeInTheDocument();
    expect(within(results).getByRole('button', { name: 'Block Pat Rider' })).toHaveClass('ops-danger-link');
    expect(within(results).getByRole('button', { name: 'Unblock Bad Bob' })).toBeInTheDocument();
    expect(within(results).queryByRole('button', { name: 'Make Bad Bob an admin' })).not.toBeInTheDocument();
  });

  it('makes someone a site admin, then refreshes the admins', async () => {
    const user = userEvent.setup();
    serve({ staff: [staff('me', 'Demo Admin', ['Admin', 'MasterAdmin'])], people: [person('p1', 'Pat Rider', ['Rider'])] });
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Search accounts' }), 'pat');
    await user.click(await screen.findByRole('button', { name: 'Make Pat Rider an admin' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make site admin' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/p1/roles', { role: 'Admin', grant: true }));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/admin/staff-accounts').length).toBe(2));
  });

  it('makes someone an organiser', async () => {
    const user = userEvent.setup();
    serve({ people: [person('p1', 'Pat Rider', ['Rider'])] });
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Search accounts' }), 'pat');
    await user.click(await screen.findByRole('button', { name: 'Make Pat Rider an admin' }));
    await user.click(screen.getByRole('menuitem', { name: 'Make organiser' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/p1/roles', { role: 'Trainer', grant: true }));
  });

  it('hides Make admin from site admins', async () => {
    const user = userEvent.setup();
    auth.roles = ['Admin'];
    serve({ people: [person('p1', 'Pat Rider', ['Rider'])] });
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Search accounts' }), 'pat');
    expect(await screen.findByRole('button', { name: 'Block Pat Rider' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /an admin$/ })).not.toBeInTheDocument();
  });

  it('blocks after asking, and unblocks', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    serve({ people: [person('p1', 'Pat Rider', ['Rider'])] });
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Search accounts' }), 'pat');
    await user.click(await screen.findByRole('button', { name: 'Block Pat Rider' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/p1/block', {}));
    await user.click(await screen.findByRole('button', { name: 'Unblock Pat Rider' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/users/p1/block'));
    expect(await screen.findByRole('button', { name: 'Block Pat Rider' })).toBeInTheDocument();
    asked.stop();
  });

  it('says when nothing matches or the search fails', async () => {
    const user = userEvent.setup();
    serve({ people: [] });
    mount();
    const box = await screen.findByRole('searchbox', { name: 'Search accounts' });
    await user.type(box, 'zz');
    expect(await screen.findByText('No account matches that')).toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/admin/users') throw new Error('offline');
      return { data: [] } as never;
    });
    await user.type(box, 'x');
    expect(await screen.findByText('Couldn’t search. Check your signal and try again.')).toBeInTheDocument();
  });

  it('copes with the lists failing to load', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the admins');
    expect(await screen.findByText('No admins yet')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invites sent' })).not.toBeInTheDocument();
  });
});
