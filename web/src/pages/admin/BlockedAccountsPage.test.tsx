import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { BlockedAccountsPage } from './BlockedAccountsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const blockedRow = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, fullName: name, email: `${id}@example.com`, roles: ['Member'], blockedAt: '2026-10-22T10:00:00Z', blockedByName: 'Demo Admin', reason: 'Spam in chat', ...extra });
const person = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, fullName: name, email: `${id}@example.com`, clubId: null, clubName: null, roles: ['Member'], isLockedOut: false, createdAt: '2026-10-01T00:00:00Z', isLocked: false, isBlocked: false, ...extra });

let blockedList: unknown[] = [];
let people: unknown[] = [];
const mount = () => render(<MemoryRouter><BlockedAccountsPage /></MemoryRouter>);

describe('BlockedAccountsPage', () => {
  beforeEach(() => {
    blockedList = [blockedRow('b1', 'Bad Bob')];
    people = [person('p1', 'Pat Rider'), person('b1', 'Bad Bob', { isBlocked: true })];
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/admin/blocked-users' ? blockedList : people }) as never);
    vi.mocked(api.post).mockResolvedValue({ data: { networksBlocked: 2 } });
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
  });

  it('shows a search and the blocked list, with no intro text or note about internet addresses', async () => {
    mount();
    expect(screen.getByRole('searchbox', { name: 'Find an account' })).toBeInTheDocument();
    expect(await screen.findByText('Bad Bob')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Blocked' })).toBeInTheDocument();
    expect(screen.getByText(/Spam in chat · 22 Oct/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unblock Bad Bob' })).toHaveClass('ops-danger-link');
    expect(screen.queryByText(/internet address|network/i)).not.toBeInTheDocument();
  });

  it('says when no one is blocked', async () => {
    blockedList = [];
    mount();
    expect(await screen.findByText('No one is blocked')).toBeInTheDocument();
  });

  it('blocks an account with a reason after asking, then lists it', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Find an account' }), 'pat');
    await user.click(await screen.findByRole('button', { name: 'Block Pat Rider' }));
    await user.type(screen.getByLabelText('Reason (only admins see it)'), '  Spam in chat ');
    blockedList = [blockedRow('p1', 'Pat Rider'), blockedRow('b1', 'Bad Bob')];
    await user.click(screen.getByRole('button', { name: 'Block account' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/p1/block', { reason: 'Spam in chat' }));
    expect(await screen.findByRole('button', { name: 'Unblock Pat Rider' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Reason (only admins see it)')).not.toBeInTheDocument();
    asked.stop();
  });

  it('blocks without a reason, and can back out of the reason box', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Find an account' }), 'pat');
    await user.click(await screen.findByRole('button', { name: 'Block Pat Rider' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Reason (only admins see it)')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Block Pat Rider' }));
    await user.click(screen.getByRole('button', { name: 'Block account' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/p1/block', { reason: null }));
    asked.stop();
  });

  it('leaves the account alone when the confirmation is declined', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(false);
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Find an account' }), 'pat');
    await user.click(await screen.findByRole('button', { name: 'Block Pat Rider' }));
    await user.click(screen.getByRole('button', { name: 'Block account' }));
    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(api.post).not.toHaveBeenCalled();
    asked.stop();
  });

  it('does not offer Block on someone already blocked', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Find an account' }), 'bob');
    const results = await screen.findByLabelText('Matching accounts');
    expect(await within(results).findByText(/Bad Bob/)).toBeInTheDocument();
    expect(within(results).getByText(/blocked/)).toBeInTheDocument();
    expect(within(results).queryByRole('button', { name: 'Block Bad Bob' })).not.toBeInTheDocument();
  });

  it('shows why a block was refused', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    vi.mocked(api.post).mockRejectedValue({ response: { status: 403, data: { detail: 'Only a master admin can block an admin account.' } } });
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Find an account' }), 'pat');
    await user.click(await screen.findByRole('button', { name: 'Block Pat Rider' }));
    await user.click(screen.getByRole('button', { name: 'Block account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a master admin can block an admin account.');
    asked.stop();
  });

  it('unblocks straight away, and shows a refusal', async () => {
    const user = userEvent.setup();
    blockedList = [blockedRow('b1', 'Bad Bob'), blockedRow('b2', 'Worse Wes')];
    vi.mocked(api.delete).mockRejectedValueOnce({ response: { status: 403, data: { detail: 'A master admin blocked this account, so only a master admin can unblock it.' } } });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Unblock Bad Bob' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('only a master admin can unblock it');
    await user.click(screen.getByRole('button', { name: 'Unblock Worse Wes' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/users/b2/block'));
    await waitFor(() => expect(screen.queryByText('Worse Wes')).not.toBeInTheDocument());
    expect(screen.getByText('Bad Bob')).toBeInTheDocument();
  });

  it('says when nothing matches, and copes with the list failing to load', async () => {
    const user = userEvent.setup();
    people = [];
    mount();
    await user.type(await screen.findByRole('searchbox', { name: 'Find an account' }), 'zz');
    expect(await screen.findByText('No account matches that')).toBeInTheDocument();
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    await user.type(screen.getByRole('searchbox', { name: 'Find an account' }), 'x');
    expect(await screen.findByText('Couldn’t search. Check your signal and try again.')).toBeInTheDocument();
  });

  it('shows an error when the blocked list will not load', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the blocked accounts');
    expect(await screen.findByText('No one is blocked')).toBeInTheDocument();
  });
});
