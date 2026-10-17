import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveHandlers } from '../../live/useLiveHub';
import type { Role } from '../../types';
import { chat, competition } from '../../test/factories';
import { CompetitionContext } from './context';
import { ChatTab } from './ChatTab';

const state = vi.hoisted(() => ({
  token: 'fake-admin-token' as string | null,
  roles: ['Admin'] as Role[],
  handlers: null as LiveHandlers | null,
  get: vi.fn(),
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: state.token ? { id: 'fake-user', fullName: 'Example Admin', roles: state.roles } : null,
    token: state.token,
    canEdit: () => state.roles.includes('Admin'),
    hasRole: (role: Role) => state.roles.includes(role),
  }),
}));
vi.mock('../../api', () => ({
  api: { get: state.get, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../live/useLiveHub', () => ({
  useLiveHub: (_competitionId: number, handlers: LiveHandlers) => { state.handlers = handlers; return { connected: true }; },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mount() {
  const value = { competition: competition(), reload: vi.fn() };
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
        <CompetitionContext.Provider value={{ competition: competition(), reload: vi.fn() }}>
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
