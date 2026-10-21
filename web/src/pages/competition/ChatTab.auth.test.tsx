import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveHandlers } from '../../live/useLiveHub';
import type { CompetitionDetail, Role } from '../../types';
import { chat, competition } from '../../test/factories';
import { CompetitionContext } from './context';
import { ChatTab } from './ChatTab';

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

function mount(extra: Partial<CompetitionDetail> = {}) {
  const value = contextValue(extra);
  return render(
    <MemoryRouter>
      <CompetitionContext.Provider value={value}>
        <ChatTab />
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

describe('ChatTab auth sessions', () => {
  it('does not offer private organiser messaging when the API omits the capability', async () => {
    state.token = 'fake-trainer-token';
    state.roles = ['Trainer'];
    state.get.mockResolvedValue({ data: [] });

    mount({ staffChatEnabled: undefined });

    expect(screen.getByText('Messaging the organisers isn’t available for this event yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Message the organisers…')).not.toBeInTheDocument();
    expect(state.post).not.toHaveBeenCalled();
  });

  it('lets a trainer message organisers when the API explicitly enables staff chat', async () => {
    state.token = 'fake-trainer-token';
    state.roles = ['Trainer'];
    state.get.mockResolvedValue({ data: [] });
    mount();

    expect(screen.queryByText('Messaging the organisers isn’t available for this event yet.')).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Message the organisers…'), 'Please call collecting ring');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(state.post).toHaveBeenCalledWith('/competitions/1/chat', { body: 'Please call collecting ring' });
  });

  it('clears private messages and ignores the previous session response after sign-out', async () => {
    const privateMessage = chat(1, { body: 'Private trainer message', type: 0, adminOnly: true });
    state.get.mockResolvedValueOnce({ data: [privateMessage] });
    const view = mount();
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
          <ChatTab />
        </CompetitionContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Private trainer message')).not.toBeInTheDocument();
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(3));
    expect(staleSignal.aborted).toBe(true);

    stale.resolve({ data: [privateMessage] });
    await act(async () => { await stale.promise; });
    expect(screen.queryByText('Private trainer message')).not.toBeInTheDocument();

    const publicMessage = chat(2, { body: 'Public announcement', type: 2 });
    publicResponse.resolve({ data: [publicMessage] });
    await act(async () => { await publicResponse.promise; });
    expect(await screen.findByText('Public announcement')).toBeInTheDocument();
  });
});
