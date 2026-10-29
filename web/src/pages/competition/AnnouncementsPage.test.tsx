import { render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { chat, competition } from '../../test/factories';
import type { ChatMessage, Team } from '../../types';
import { AnnouncementsPage } from './AnnouncementsPage';
import { CompetitionContext } from './context';

const state = vi.hoisted(() => ({ roles: ['Admin'] as string[] }));
vi.mock('../../api', () => ({
  pinChatMessage: async (competitionId: number, messageId: number) => (await import('../../api')).api.post(`/competitions/${competitionId}/chat/${messageId}/pin`, {}),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin', roles: state.roles }, hasRole: (role: string) => state.roles.includes(role), canEdit: () => true, canOrganise: () => false }),
}));
vi.mock('../../live/useLiveHub', () => ({ useLiveHub: () => ({ connected: true }) }));

let feed: ChatMessage[] = [];
const at = (minutes: number) => new Date(Date.UTC(2026, 5, 1, 12, minutes)).toISOString();
const team = { id: 1, trainerUserId: 'u1', displayName: 'Warwickshire Hunt A' } as Team;

function mount(path = '/competitions/1/announcements') {
  const value = { competition: competition({ teams: [team] }), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CompetitionContext.Provider value={value}>
        <Routes>
          <Route path="/competitions/:id/announcements" element={<AnnouncementsPage />} />
          <Route path="/competitions/:id/contact" element={<p>Contact page</p>} />
        </Routes>
      </CompetitionContext.Provider>
    </MemoryRouter>,
  );
}

describe('AnnouncementsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    state.roles = ['Admin'];
    feed = [
      chat(1, { body: 'Lunch at one', createdAt: at(1) }),
      chat(2, { body: 'Finals at four', createdAt: at(2) }),
      chat(3, { body: 'Finals at four', tag: 'banner', createdAt: at(3) }),
      chat(4, { adminOnly: true, userId: 'u1', authorName: 'Pat Rider', body: 'Where do we park?', createdAt: at(4) }),
    ];
    vi.mocked(api.get).mockImplementation(async () => ({ data: feed }) as never);
    vi.mocked(api.post).mockReset();
    vi.mocked(api.delete).mockReset().mockResolvedValue({ data: {} });
  });

  it('shows pinned, the new box and sent without the pinned one on the Announcements tab', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Messages & Announcements' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Announcements' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Messages (1)' })).toHaveAttribute('aria-selected', 'false');
    expect(await screen.findByRole('heading', { name: 'Pinned' })).toBeInTheDocument();
    const pinned = screen.getByRole('heading', { name: 'Pinned' }).parentElement!;
    expect(within(pinned).getByText('Finals at four')).toBeInTheDocument();
    expect(within(pinned).getByRole('button', { name: 'Unpin' })).toHaveClass('ann-red');
    const box = screen.getByPlaceholderText('Write an announcement');
    expect(box.tagName).toBe('TEXTAREA');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    const sent = screen.getByRole('list', { name: 'Sent announcements' });
    expect(within(sent).getAllByRole('listitem')).toHaveLength(1);
    expect(within(sent).getByText('Lunch at one')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Messages' })).toBeNull();
  });

  it('switches to the chat list on the Messages tab, with one row for each person', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('tab', { name: 'Messages (1)' }));
    const link = await screen.findByRole('link', { name: /Pat Rider · Warwickshire Hunt A/ });
    expect(link).toHaveAttribute('href', '/competitions/1/messages/u1');
    expect(within(link).getByLabelText('1 unread')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Write an announcement')).toBeNull();
    expect(screen.getByRole('tab', { name: /^Messages/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens on the Messages tab from ?tab=messages (the address old links redirect to)', async () => {
    mount('/competitions/1/announcements?tab=messages');
    expect(await screen.findByRole('link', { name: /Pat Rider/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pinned' })).toBeNull();
  });

  it('sends anyone who is not an organiser to the contact page instead', async () => {
    state.roles = ['Member'];
    mount();
    expect(await screen.findByText('Contact page')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('gives the Pin pill a 44px tap target through an invisible hit area', () => {
    const css = readFileSync(resolve(__dirname, 'announcements.css'), 'utf8');
    expect(css).toMatch(/\.ann-pill::after\s*\{[^}]*inset:\s*-6px/);
    expect(css).toMatch(/\.ann-pill\s*\{[^}]*min-height:\s*32px/);
  });

  it('hides Pinned and Sent when there is nothing to show, and says when there are no messages', async () => {
    feed = [];
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('tab', { name: 'Messages' }));
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pinned' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sent' })).toBeNull();
  });

  it('sends an announcement, marks it as just sent and keeps the draft while typing', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: chat(9, { body: 'Parking in field two', tag: 'general', createdAt: at(10) }) });
    mount();
    await user.type(await screen.findByPlaceholderText('Write an announcement'), 'Parking in field two');
    expect(localStorage.getItem('mg.announceDraft.1')).toBe('Parking in field two');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/chat/announcement', { body: 'Parking in field two', tag: 'general' }));
    expect(await screen.findByText('Sent just now')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Write an announcement')).toHaveValue('');
    expect(localStorage.getItem('mg.announceDraft.1')).toBeNull();
  });

  it('shows why sending failed', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 403 } }).mockRejectedValueOnce(new Error('offline'));
    mount();
    await user.type(await screen.findByPlaceholderText('Write an announcement'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Posting is blocked from this network');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t send that announcement'));
    expect(screen.getByPlaceholderText('Write an announcement')).toHaveValue('Hello');
  });

  it('pins a sent announcement as the new notice and clears the old one', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce({ data: chat(1, { body: 'Lunch at one', tag: 'pinned', createdAt: at(1) }) });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Pin: Lunch at one' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/chat/1/pin', {}));
    expect(api.delete).not.toHaveBeenCalled();
    const pinned = (await screen.findByRole('heading', { name: 'Pinned' })).parentElement!;
    await waitFor(() => expect(within(pinned).getByText('Lunch at one')).toBeInTheDocument());
  });

  it('keeps the existing pin when the server refuses a change', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    mount();
    await user.click(await screen.findByRole('button', { name: 'Pin: Lunch at one' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t pin that announcement');
    expect(within(screen.getByRole('heading', { name: 'Pinned' }).parentElement!).getByText('Finals at four')).toBeInTheDocument();
    vi.mocked(api.post).mockResolvedValueOnce({ data: { nope: true } });
    await user.click(screen.getByRole('button', { name: 'Pin: Lunch at one' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t pin that announcement'));
  });

  it('unpins through the pin endpoint and preserves the announcement', async () => {
    const user = userEvent.setup();
    mount();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await user.click(await screen.findByRole('button', { name: 'Unpin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t unpin that');
    vi.mocked(api.post).mockResolvedValueOnce({ data: chat(3, { body: 'Finals at four', tag: null }) });
    await user.click(screen.getByRole('button', { name: 'Unpin' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/chat/3/pin', {}));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pinned' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Sent' })).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('offers to try again when the messages will not load', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the announcements');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Pinned' })).toBeInTheDocument();
  });
});
