import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { competition, chat, team } from '../../test/factories';
import { autoConfirm } from '../../test/confirm';
import type { CompetitionDetail, Role } from '../../types';
import { CompetitionContext } from './context';
import { ContactOrganisersPage } from './ContactOrganisersPage';

const state = vi.hoisted(() => ({ user: true, roles: ['Member'] as string[], get: vi.fn(), post: vi.fn(), del: vi.fn() }));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: state.user ? { id: 'me', fullName: 'Sam Ellis', roles: state.roles } : null,
    canEdit: () => state.roles.includes('Admin'),
    hasRole: (role: Role) => state.roles.includes(role),
    canOrganise: () => false,
  }),
}));
vi.mock('../../api', () => ({ api: { get: state.get, post: state.post, put: vi.fn(), delete: state.del } }));
vi.mock('../../live/useLiveHub', () => ({ useLiveHub: () => ({ connected: true }) }));

function Where() {
  const { pathname, state: navState } = useLocation();
  return <p data-testid="where">{pathname}{(navState as { from?: string } | null)?.from ? ` from ${(navState as { from: string }).from}` : ''}</p>;
}

function mount(extra: Partial<CompetitionDetail> = {}, initial: string[] = ['/competitions/1/details', '/competitions/1/contact']) {
  const value = { competition: competition({ staffChatEnabled: true, ...extra }), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] };
  return render(
    <MemoryRouter initialEntries={initial} initialIndex={initial.length - 1}>
      <CompetitionContext.Provider value={value}>
        <Routes>
          <Route path="/competitions/:id/contact" element={<ContactOrganisersPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </CompetitionContext.Provider>
    </MemoryRouter>,
  );
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  state.user = true;
  state.roles = ['Member'];
  state.get.mockResolvedValue({ data: [] });
});

describe('signed out', () => {
  beforeEach(() => { state.user = false; state.roles = []; });

  it('says one plain thing and offers Sign in and Go back, with no lock or empty message box', () => {
    mount();
    expect(screen.getByText('Sign in to message the organisers. Only they can read what you send.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    expect(screen.queryByText('Your messages')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('goes back to the page you came from', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/competitions/1/details');
  });

  it('goes to the details when the page was opened directly', async () => {
    mount({}, ['/competitions/1/contact']);
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/competitions/1/details');
  });
});

describe('signed in', () => {
  it('shows one thread: your messages and the organisers’ replies, under a heading for each day', async () => {
    state.get.mockResolvedValue({ data: [
      chat(3, { body: 'Yes, park by the stables.', type: 0, adminOnly: true, userId: 'admin-1', recipientUserId: 'me', authorName: 'Pat Organiser', createdAt: daysAgo(0) }),
      chat(2, { body: 'Can we bring a second lorry?', type: 0, adminOnly: true, userId: 'me', createdAt: daysAgo(1) }),
      chat(1, { body: 'Not for me', type: 0, adminOnly: true, userId: 'someone-else', createdAt: daysAgo(1) }),
    ] });
    mount();
    expect(await screen.findByText('Yes, park by the stables.')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.queryByText('Not for me')).not.toBeInTheDocument();
    expect(screen.queryByText('Your messages')).not.toBeInTheDocument();
    const mine = screen.getByText('Can we bring a second lorry?').closest('.ev-bub')!;
    expect(mine).toHaveClass('ev-bub-me');
    const theirs = screen.getByText('Yes, park by the stables.').closest('.ev-bub')!;
    expect(theirs).toHaveClass('ev-bub-them');
    expect(within(theirs as HTMLElement).getByText('Pat Organiser')).toBeInTheDocument();
  });

  it('shows an older day as a date', async () => {
    state.get.mockResolvedValue({ data: [chat(1, { body: 'Old news', type: 0, adminOnly: true, userId: 'me', createdAt: daysAgo(20) })] });
    mount();
    expect(await screen.findByText('Old news')).toBeInTheDocument();
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument();
  });

  it('keeps the round send arrow faded until there is text, then sends and clears the box', async () => {
    state.post.mockResolvedValue({ data: chat(9, { body: 'Hello', type: 0, adminOnly: true, userId: 'me' }) });
    mount();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Message the organisers'), 'Hello');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(state.post).toHaveBeenCalledWith('/competitions/1/chat', { body: 'Hello' });
    expect(await screen.findByText('Hello', { selector: '.ev-bub' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Message the organisers')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('sends with Enter, but not Shift and Enter', async () => {
    state.post.mockResolvedValue({ data: chat(9, { body: 'One', type: 0, adminOnly: true, userId: 'me' }) });
    mount();
    const box = screen.getByPlaceholderText('Message the organisers');
    await userEvent.type(box, 'One{Shift>}{Enter}{/Shift}');
    expect(state.post).not.toHaveBeenCalled();
    await userEvent.type(box, '{Enter}');
    expect(state.post).toHaveBeenCalledTimes(1);
  });

  it('says in a small pill that only you and the organisers see the thread', async () => {
    mount();
    expect(await screen.findByText('Only you and the organisers see this')).toBeInTheDocument();
  });

  it('says so, without a message box, when the event has no private messaging', () => {
    mount({ staffChatEnabled: undefined });
    expect(screen.getByText('Messaging the organisers isn’t available for this event yet.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Message the organisers')).not.toBeInTheDocument();
    expect(screen.queryByText('Only you and the organisers see this')).not.toBeInTheDocument();
  });

  it('says there are no messages yet, plainly', async () => {
    mount();
    expect(await screen.findByText('No messages yet.')).toBeInTheDocument();
  });

  it('says so when the messages cannot be loaded, and tries again', async () => {
    state.get.mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load messages');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No messages yet.')).toBeInTheDocument();
  });

  it('tells the person when a message could not be sent', async () => {
    state.post.mockRejectedValue({ response: { status: 403 } });
    mount();
    await userEvent.type(screen.getByPlaceholderText('Message the organisers'), 'Hi');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Posting is blocked from this network');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('offers Try again when a message could not be sent, and sends it again', async () => {
    state.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { id: 5, body: 'Hi', adminOnly: true, userId: 'u1', createdAt: '2026-10-26T09:00:00Z', competitionId: 1, authorName: 'Me' } });
    mount();
    await userEvent.type(screen.getByPlaceholderText('Message the organisers'), 'Hi');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t send that message. Check your signal and try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('an organiser', () => {
  const sam = { id: 'sam', name: 'Sam Lee' };
  const incoming = (id: number, body: string, createdAt: string, userId = sam.id, authorName = sam.name) =>
    chat(id, { body, type: 0, adminOnly: true, userId, authorName, createdAt });
  const reply = (id: number, body: string, createdAt: string, to = sam.id) =>
    chat(id, { body, type: 0, adminOnly: true, userId: 'me', recipientUserId: to, authorName: 'Sam Ellis', createdAt });

  beforeEach(() => {
    state.roles = ['Admin'];
    state.get.mockResolvedValue({ data: [
      incoming(1, 'Can Leo ride Pepper in Heat 2?', daysAgo(0), 'sam'),
      incoming(2, 'Is there camping on site?', daysAgo(3), 'kim', 'Kim Park'),
      reply(3, 'Yes, in the far field.', daysAgo(3), 'kim'),
    ] });
  });

  const mountAdmin = () => mount({ teams: [team(1, { trainerUserId: 'sam', displayName: 'Warwickshire Hunt A' })] });

  it('sees a chat list with one row for each person: name and team, the last message, time and unread count', async () => {
    localStorage.setItem('mg.threadSeen.1', JSON.stringify({ kim: new Date().toISOString() }));
    mountAdmin();
    const list = await screen.findByRole('list', { name: 'Messages' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Sam Lee · Warwickshire Hunt A');
    expect(rows[0]).toHaveTextContent('Can Leo ride Pepper in Heat 2?');
    expect(within(rows[0]).getByLabelText('1 unread')).toHaveTextContent('1');
    expect(rows[1]).toHaveTextContent('Kim Park');
    expect(rows[1]).toHaveTextContent('Yes, in the far field.');
    expect(within(rows[1]).queryByLabelText(/unread/)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says so when nobody has written', async () => {
    state.get.mockResolvedValue({ data: [] });
    mountAdmin();
    expect(await screen.findByText('No messages yet.')).toBeInTheDocument();
  });

  it('says so when the messages cannot be loaded', async () => {
    state.get.mockRejectedValueOnce(new Error('offline'));
    mountAdmin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load messages');
  });

  it('opens one thread per person, with their messages on the left, their own replies on the right and a reply box', async () => {
    mount({}, ['/competitions/1/contact?with=kim']);
    expect(await screen.findByText('Is there camping on site?')).toBeInTheDocument();
    expect(screen.getByText('Only you and Kim Park see this')).toBeInTheDocument();
    expect(screen.queryByText('Can Leo ride Pepper in Heat 2?')).not.toBeInTheDocument();
    expect(screen.getByText('Is there camping on site?').closest('.ev-bub')).toHaveClass('ev-bub-them');
    expect(screen.getByText('Yes, in the far field.').closest('.ev-bub')).toHaveClass('ev-bub-me');
    expect(screen.getByPlaceholderText('Reply')).toBeInTheDocument();
  });

  it('opens a thread from the list, and reading it is remembered', async () => {
    mountAdmin();
    await userEvent.click(await screen.findByRole('button', { name: /Sam Lee/ }));
    expect(await screen.findByText('Only you and Sam Lee see this')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('mg.threadSeen.1') ?? '{}').sam).toBeTruthy());
  });

  it('replies privately to the person whose thread is open', async () => {
    state.post.mockResolvedValue({ data: reply(9, 'See you there.', new Date().toISOString(), 'kim') });
    mount({}, ['/competitions/1/contact?with=kim']);
    await screen.findByText('Is there camping on site?');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Reply'), 'See you there.');
    await userEvent.click(send);
    expect(state.post).toHaveBeenCalledWith('/competitions/1/chat', { body: 'See you there.', replyToUserId: 'kim' });
    expect(await screen.findByText('See you there.', { selector: '.ev-bub' })).toBeInTheDocument();
  });

  it('deletes a message from its menu, after asking', async () => {
    const asked = autoConfirm(true);
    state.del.mockResolvedValue({ data: {} });
    mount({}, ['/competitions/1/contact?with=kim']);
    await screen.findByText('Is there camping on site?');
    await userEvent.click(screen.getByRole('button', { name: 'More for message: Is there camping on site?' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('It disappears for everyone.'));
    expect(state.del).toHaveBeenCalledWith('/competitions/1/chat/2');
    await waitFor(() => expect(screen.queryByText('Is there camping on site?')).not.toBeInTheDocument());
  });

  it('keeps a message when the question is answered no, and says so when it cannot be deleted', async () => {
    autoConfirm([false, true]);
    state.del.mockRejectedValue(new Error('offline'));
    mount({}, ['/competitions/1/contact?with=kim']);
    await screen.findByText('Is there camping on site?');
    await userEvent.click(screen.getByRole('button', { name: 'More for message: Is there camping on site?' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(state.del).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete message' }));
    expect(await screen.findByText('Couldn’t delete that message. Check your signal and try again.')).toBeInTheDocument();
    expect(screen.getByText('Is there camping on site?', { selector: '.ev-bub' })).toBeInTheDocument();
  });

  it('blocks a sender from a message\'s menu, after asking, and says what was blocked', async () => {
    autoConfirm(true);
    state.post.mockResolvedValue({ data: { alreadyBlocked: false, ipAddress: '203.0.113.9' } });
    mount({}, ['/competitions/1/contact?with=kim']);
    await screen.findByText('Is there camping on site?');
    await userEvent.click(screen.getByRole('button', { name: 'More for message: Is there camping on site?' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Block sender' }));
    expect(await screen.findByText('Blocked IP 203.0.113.9.')).toBeInTheDocument();
    expect(state.post).toHaveBeenCalledWith('/competitions/1/chat/2/block-author', {});
  });

  it('says so when a sender cannot be blocked', async () => {
    autoConfirm(true);
    state.post.mockRejectedValue({ response: { data: { message: 'No IP on record.' } } });
    mount({}, ['/competitions/1/contact?with=kim']);
    await screen.findByText('Is there camping on site?');
    await userEvent.click(screen.getByRole('button', { name: 'More for message: Is there camping on site?' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Block sender' }));
    expect(await screen.findByText('No IP on record.')).toBeInTheDocument();
  });

  it('offers only Delete on the organisers\' own replies', async () => {
    mount({}, ['/competitions/1/contact?with=kim']);
    await screen.findByText('Yes, in the far field.');
    await userEvent.click(screen.getByRole('button', { name: 'More for message: Yes, in the far field.' }));
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByRole('button', { name: 'Delete message' })).toHaveClass('kit-redtext');
    expect(sheet.queryByRole('button', { name: 'Block sender' })).not.toBeInTheDocument();
  });

  it('does not offer a menu to someone who is not an admin', async () => {
    state.roles = ['Member'];
    state.get.mockResolvedValue({ data: [incoming(1, 'Hello', daysAgo(0), 'me')] });
    mount();
    await screen.findByText('Hello');
    expect(screen.queryByRole('button', { name: /More for message/ })).not.toBeInTheDocument();
  });
});
