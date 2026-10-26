import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveHandlers } from '../../live/useLiveHub';
import type { CompetitionDetail, Role } from '../../types';
import { chat, competition } from '../../test/factories';
import { CompetitionContext } from './context';
import { ChatTab } from './ChatTab';
import { ContactOrganisersPage } from './ContactOrganisersPage';

const state = vi.hoisted(() => ({
  token: 'fake-admin-token' as string | null,
  roles: ['Admin'] as Role[],
  handlers: null as LiveHandlers | null,
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: state.token ? { id: 'fake-user', fullName: 'Example Admin', roles: state.roles } : null,
    token: state.token,
    canEdit: () => state.roles.includes('Admin'),
    hasRole: (role: Role) => state.roles.includes(role),
    canOrganise: () => false,
  }),
}));
vi.mock('../../api', () => ({
  api: { get: state.get, post: state.post, put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../live/useLiveHub', () => ({
  useLiveHub: (_competitionId: number, handlers: LiveHandlers) => { state.handlers = handlers; return { connected: true }; },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function contextValue(extra: Partial<CompetitionDetail> = {}) {
  return { competition: competition(extra), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] };
}

function mountChat(extra: Partial<CompetitionDetail> = {}) {
  const value = contextValue(extra);
  return render(
    <MemoryRouter>
      <CompetitionContext.Provider value={value}>
        <ChatTab />
      </CompetitionContext.Provider>
    </MemoryRouter>,
  );
}

function mountContact(extra: Partial<CompetitionDetail> = {}) {
  const value = contextValue(extra);
  return render(
    <MemoryRouter>
      <CompetitionContext.Provider value={value}>
        <ContactOrganisersPage />
      </CompetitionContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.token = 'fake-admin-token';
  state.roles = ['Admin'];
  state.handlers = null;
  HTMLElement.prototype.scrollTo = vi.fn();
});

describe('ChatTab and ContactOrganisersPage auth sessions', () => {
  it('does not offer private organiser messaging when the API omits the capability', async () => {
    state.token = 'fake-trainer-token';
    state.roles = ['Trainer'];
    state.get.mockResolvedValue({ data: [] });

    mountChat({ staffChatEnabled: undefined });

    expect(screen.getByText('Messaging the organisers isn’t available for this event yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Message the organisers…')).not.toBeInTheDocument();
    expect(state.post).not.toHaveBeenCalled();
  });

  it('links non-organisers from Live stream to the dedicated ContactOrganisersPage and lets them message organisers there', async () => {
    state.token = 'fake-trainer-token';
    state.roles = ['Trainer'];
    state.get.mockResolvedValue({ data: [] });
    const chatView = mountChat({ staffChatEnabled: true });

    expect(screen.queryByRole('tab', { name: 'Message Organisers' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Message organisers/i })).toHaveAttribute('href', '/competitions/1/contact');
    chatView.unmount();

    mountContact({ staffChatEnabled: true });
    await userEvent.type(screen.getByPlaceholderText('Message the organisers…'), 'Please call collecting ring');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(state.post).toHaveBeenCalledWith('/competitions/1/chat', { body: 'Please call collecting ring' });
  });

  it.each(['Manager', 'Member', 'Rider'] as const)('lets a %s message the organisers privately on ContactOrganisersPage', async (role) => {
    state.token = 'fake-member-token';
    state.roles = [role];
    state.get.mockResolvedValue({ data: [] });
    state.post.mockResolvedValue({ data: chat(9, { body: 'Where is the ring?', type: 0, adminOnly: true, userId: 'fake-user' }) });
    mountContact({ staffChatEnabled: true });

    await userEvent.type(screen.getByPlaceholderText('Message the organisers…'), 'Where is the ring?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(state.post).toHaveBeenCalledWith('/competitions/1/chat', { body: 'Where is the ring?' });
    expect(await screen.findByText('Where is the ring?')).toBeInTheDocument();
  });

  it('shows a person their own private thread and the organisers’ reply, not other people’s messages', async () => {
    state.token = 'fake-member-token';
    state.roles = ['Member'];
    state.get.mockResolvedValue({ data: [
      chat(1, { body: 'My question', type: 0, adminOnly: true, userId: 'fake-user' }),
      chat(2, { body: 'Your answer', type: 0, adminOnly: true, userId: 'admin-1', recipientUserId: 'fake-user' }),
      chat(3, { body: 'Someone else', type: 0, adminOnly: true, userId: 'other-user' }),
    ] });
    mountContact({ staffChatEnabled: true });

    expect(await screen.findByText('Your answer')).toBeInTheDocument();
    expect(screen.getByText('My question')).toBeInTheDocument();
    expect(screen.queryByText('Someone else')).not.toBeInTheDocument();
  });

  it('lets an admin reply privately to a message on ContactOrganisersPage instead of announcing to everyone', async () => {
    state.get.mockResolvedValue({ data: [chat(1, { body: 'Where is the ring?', type: 0, adminOnly: true, userId: 'asker-1', authorName: 'Sam Rider' })] });
    state.post.mockResolvedValue({ data: chat(2, { body: 'By the lorries', type: 0, adminOnly: true, userId: 'fake-user', recipientUserId: 'asker-1' }) });
    mountContact({ staffChatEnabled: true });

    await userEvent.click(await screen.findByRole('button', { name: /Reply privately/ }));
    expect(screen.getByText(/Private reply to Sam Rider/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Write a private reply…'), 'By the lorries');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(state.post).toHaveBeenCalledWith('/competitions/1/chat', { body: 'By the lorries', replyToUserId: 'asker-1' });
    expect(state.post).not.toHaveBeenCalledWith('/competitions/1/chat/announcement', expect.anything());
    await waitFor(() => expect(screen.queryByText(/Private reply to/)).not.toBeInTheDocument());
  });

  it('clears private messages and ignores the previous session response after sign-out', async () => {
    const privateMessage = chat(1, { body: 'Private trainer message', type: 0, adminOnly: true });
    state.get.mockResolvedValueOnce({ data: [privateMessage] });
    const view = mountContact();
    expect(await screen.findByText('Private trainer message')).toBeInTheDocument();

    const stale = deferred<{ data: typeof privateMessage[] }>();
    state.get.mockReturnValueOnce(stale.promise);
    act(() => state.handlers?.onReady?.());
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
    const staleSignal = state.get.mock.calls[1][1].signal as AbortSignal;

    const publicResponse = deferred<{ data: typeof privateMessage[] }>();
    state.get.mockReturnValueOnce(publicResponse.promise);
    state.token = null;
    state.roles = [];
    view.rerender(
      <MemoryRouter>
        <CompetitionContext.Provider value={contextValue()}>
          <ContactOrganisersPage />
        </CompetitionContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Private trainer message')).not.toBeInTheDocument();
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(3));
    expect(staleSignal.aborted).toBe(true);

    stale.resolve({ data: [privateMessage] });
    await act(async () => { await stale.promise; });
    expect(screen.queryByText('Private trainer message')).not.toBeInTheDocument();
  });

  it('keeps Announcements on ChatTab free of private messages and links admins to Organiser messages', async () => {
    state.token = 'fake-admin-token';
    state.roles = ['Admin'];
    state.get.mockResolvedValue({
      data: [
        chat(1, { body: 'Official heat 1 update', type: 2, adminOnly: false }),
        chat(2, { body: 'Private question from rider', type: 0, adminOnly: true, userId: 'rider-1' }),
      ],
    });
    mountChat({ staffChatEnabled: true });

    expect(await screen.findByText('Official heat 1 update')).toBeVisible();
    expect(screen.queryByText('Private question from rider')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Organiser messages \(1\)/ })).toHaveAttribute('href', '/competitions/1/contact');
  });
});
