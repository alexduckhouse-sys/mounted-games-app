import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { competition, chat } from '../../test/factories';
import type { CompetitionDetail, Role } from '../../types';
import { CompetitionContext } from './context';
import { ContactOrganisersPage } from './ContactOrganisersPage';

const state = vi.hoisted(() => ({ user: true, roles: ['Member'] as string[], organise: false, get: vi.fn(), post: vi.fn(), del: vi.fn() }));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: state.user ? { id: 'me', fullName: 'Sam Ellis', roles: state.roles } : null,
    canEdit: () => state.roles.includes('Admin'),
    hasRole: (role: Role) => state.roles.includes(role),
    canOrganise: () => state.organise,
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
          <Route path="/competitions/:id/announcements" element={<Where />} />
          <Route path="/competitions/:id/messages/:userId" element={<Where />} />
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
  state.organise = false;
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

describe('an organiser opening the old contact address', () => {
  it('lands on Announcements, where their messages are, and never fetches the chat here', () => {
    state.roles = ['Admin'];
    mount({}, ['/competitions/1/contact']);
    expect(screen.getByTestId('where')).toHaveTextContent('/competitions/1/announcements');
    expect(state.get).not.toHaveBeenCalled();
  });

  it('opens a person\'s thread from a ?with= link (old notification and bookmark links)', () => {
    state.roles = ['Admin'];
    mount({}, ['/competitions/1/contact?with=kim']);
    expect(screen.getByTestId('where')).toHaveTextContent('/competitions/1/messages/kim');
  });
});

describe('everyone else', () => {
  it('sees only their own thread with the organisers, with no moderation menu', async () => {
    state.roles = ['Member'];
    state.get.mockResolvedValue({ data: [
      chat(1, { body: 'Hello', type: 0, adminOnly: true, userId: 'me', createdAt: daysAgo(0) }),
      chat(2, { body: 'Someone else\'s', type: 0, adminOnly: true, userId: 'other', createdAt: daysAgo(0) }),
      chat(3, { body: 'Reply for me', type: 0, adminOnly: true, userId: 'org', recipientUserId: 'me', authorName: 'Org', createdAt: daysAgo(0) }),
    ] });
    mount();
    await screen.findByText('Hello');
    expect(screen.getByText('Reply for me')).toBeInTheDocument();
    expect(screen.queryByText('Someone else\'s')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More for message/ })).not.toBeInTheDocument();
  });

  it('is told when private messaging is switched off', async () => {
    mount({ staffChatEnabled: false });
    expect(await screen.findByText('Messaging the organisers isn’t available for this event yet.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
