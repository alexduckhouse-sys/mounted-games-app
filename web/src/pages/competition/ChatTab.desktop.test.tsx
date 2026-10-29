import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  pinChatMessage: async (competitionId: number, messageId: number) => (await import('../../api')).api.post(`/competitions/${competitionId}/chat/${messageId}/pin`, {}),
  api: { get: state.get, post: state.post, put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../live/useLiveHub', () => ({
  useLiveHub: (_competitionId: number, handlers: LiveHandlers) => { state.handlers = handlers; return { connected: true }; },
}));

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
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => vi.unstubAllGlobals());

describe('ChatTab on a laptop', () => {
  it('shows every announcement inline with no All sheet, and sends with Enter', async () => {
    state.get.mockResolvedValue({ data: [1, 2, 3, 4, 5].map((id) => chat(id, { body: `Note ${id}` })) });
    mount();

    expect(await screen.findByText('Note 1')).toBeInTheDocument();
    expect(screen.getAllByText('Note 5').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^All / })).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Announcement' }), 'Lunch at one{Enter}');
    expect(state.post).toHaveBeenCalledWith('/competitions/1/chat/announcement', { body: 'Lunch at one', tag: 'general' });
  });

  it('keeps a new line on Shift+Enter', async () => {
    state.get.mockResolvedValue({ data: [] });
    mount();
    const box = screen.getByRole('textbox', { name: 'Announcement' });
    await userEvent.type(box, 'a{Shift>}{Enter}{/Shift}b');
    expect(box).toHaveValue('a\nb');
    expect(state.post).not.toHaveBeenCalled();
  });
});
