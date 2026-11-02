import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { chat, competition } from '../../test/factories';
import type { ChatMessage, Team } from '../../types';
import { CompetitionContext } from './context';
import { MessageThreadPage } from './MessageThreadPage';

const state = vi.hoisted(() => ({ roles: ['Admin'] as string[], organise: false }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin', roles: state.roles }, hasRole: (role: string) => state.roles.includes(role), canEdit: () => true, canOrganise: () => state.organise }),
}));
vi.mock('../../live/useLiveHub', () => ({ useLiveHub: () => ({ connected: true }) }));

let feed: ChatMessage[] = [];
let blocked: unknown[] = [];
let people: unknown[] = [];
const at = (minutes: number) => new Date(Date.UTC(2026, 5, 1, 12, minutes)).toISOString();

function mount(teams: Team[] = []) {
  const value = { competition: competition({ teams }), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] };
  return render(
    <MemoryRouter initialEntries={['/competitions/1/messages/u1']}>
      <CompetitionContext.Provider value={value}>
        <Routes>
          <Route path="/competitions/:id/messages/:userId" element={<MessageThreadPage />} />
          <Route path="/competitions/:id/contact" element={<p>Contact page</p>} />
        </Routes>
      </CompetitionContext.Provider>
    </MemoryRouter>,
  );
}

describe('MessageThreadPage', () => {
  beforeEach(() => {
    localStorage.clear();
    state.roles = ['Admin'];
    state.organise = false;
    feed = [
      chat(1, { adminOnly: true, userId: 'u1', authorName: 'Pat Rider', body: 'Where do we park?', createdAt: at(1) }),
      chat(2, { adminOnly: true, userId: 'admin', recipientUserId: 'u1', authorName: 'Org', body: 'Field two', createdAt: at(2) }),
      chat(3, { adminOnly: true, userId: 'u2', authorName: 'Someone Else', body: 'Not this thread', createdAt: at(3) }),
    ];
    blocked = [];
    people = [{ id: 'u1', fullName: 'Pat Rider', roles: ['Trainer'] }, { id: 'x', fullName: 'Pat Rider', roles: ['Member'] }];
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/admin/blocked-users' ? blocked : url === '/admin/users' ? people : feed }) as never);
    vi.mocked(api.post).mockReset().mockResolvedValue({ data: chat(9, { adminOnly: true, userId: 'admin', recipientUserId: 'u1', body: 'Sent!', createdAt: at(9) }) });
    vi.mocked(api.delete).mockReset().mockResolvedValue({ data: {} });
  });

  it('shows the person, a role chip with their team, only their messages, and Block beside the name', async () => {
    mount([{ id: 1, trainerUserId: 'u1', displayName: 'Warwickshire Hunt A' } as Team]);
    expect(await screen.findByRole('heading', { name: 'Pat Rider' })).toBeInTheDocument();
    expect(await screen.findByText('Trainer, Warwickshire Hunt A')).toBeInTheDocument();
    expect(screen.getByText('Where do we park?')).toBeInTheDocument();
    expect(screen.getByText('Field two')).toBeInTheDocument();
    expect(screen.queryByText('Not this thread')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Block' })).toHaveClass('ann-red');
    expect(screen.getByRole('link', { name: 'Back to messages' })).toHaveAttribute('href', '/competitions/1/announcements');
  });

  it('works out the role from the account when they have no team here', async () => {
    mount();
    expect(await screen.findByText('Organiser')).toBeInTheDocument();
  });

  it('sends a private reply', async () => {
    const user = userEvent.setup();
    mount();
    const input = await screen.findByRole('textbox', { name: 'Message' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(input, 'Sent!');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/chat', { body: 'Sent!', replyToUserId: 'u1' }));
    expect(await screen.findByText('Sent!')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('says when a message did not send', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    mount();
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t send that message');
  });

  it('blocks after asking, then shows the note with Unblock and hides the message box', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    mount();
    await user.click(await screen.findByRole('button', { name: 'Block' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/u1/block', { reason: null }));
    expect(await screen.findByRole('status')).toHaveTextContent('You’ve blocked Pat Rider. They can’t message, post in chat or enter.');
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/users/u1/block'));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    asked.stop();
  });

  it('does not block when the organiser backs out, and reports failures', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm([false, true]);
    mount();
    await user.click(await screen.findByRole('button', { name: 'Block' }));
    expect(api.post).not.toHaveBeenCalled();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('nope'));
    await user.click(screen.getByRole('button', { name: 'Block' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t block Pat Rider');
    asked.stop();
  });

  it('starts blocked when the account already is, and reports an unblock that fails', async () => {
    const user = userEvent.setup();
    blocked = [{ id: 'u1', fullName: 'Pat Rider' }];
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('nope'));
    mount();
    await user.click(await screen.findByRole('button', { name: 'Unblock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t unblock Pat Rider');
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
  });

  it('copes with the blocked list and account lookup failing', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/competitions/1/chat') return { data: feed } as never;
      throw new Error('offline');
    });
    mount();
    expect(await screen.findByRole('button', { name: 'Block' })).toBeInTheDocument();
    expect(screen.queryByText('Organiser')).toBeNull();
  });

  it('shows a load error', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/admin/blocked-users') return { data: [] } as never;
      throw new Error('offline');
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the messages');
  });

  it('sends anyone who is not an organiser to the contact page', async () => {
    state.roles = ['Member'];
    mount();
    expect(await screen.findByText('Contact page')).toBeInTheDocument();
  });

  it('lets an event organiser who is not a site admin read and reply, without Block', async () => {
    state.roles = ['Trainer']; state.organise = true;
    mount();
    expect(await screen.findByText('Where do we park?')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith('/admin/blocked-users', expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'More for message: Where do we park?' }));
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByRole('button', { name: 'Delete message' })).toBeInTheDocument();
    expect(sheet.queryByRole('button', { name: 'Block sender' })).toBeNull();
  });

  it('deletes a message from its menu, after asking', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    mount();
    await user.click(await screen.findByRole('button', { name: 'More for message: Where do we park?' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/1/chat/1'));
    await waitFor(() => expect(screen.queryByText('Where do we park?')).toBeNull());
    asked.stop();
  });

  it('keeps a message when the question is answered no, and says so when it cannot be deleted', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm([false, true]);
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('offline'));
    mount();
    await user.click(await screen.findByRole('button', { name: 'More for message: Where do we park?' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete message' }));
    expect(await screen.findByText('Couldn’t delete that message. Check your signal and try again.')).toBeInTheDocument();
    expect(screen.getAllByText('Where do we park?').length).toBeGreaterThan(0);
    asked.stop();
  });

  it('blocks a sender\'s network from a message\'s menu, and says what was blocked', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    vi.mocked(api.post).mockResolvedValueOnce({ data: { alreadyBlocked: false, ipAddress: '203.0.113.9' } });
    mount();
    await user.click(await screen.findByRole('button', { name: 'More for message: Where do we park?' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Block sender' }));
    expect(await screen.findByText('Blocked IP 203.0.113.9.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/competitions/1/chat/1/block-author', {});
    asked.stop();
  });

  it('says so when a sender cannot be blocked, and offers only Delete on the organisers\' own replies', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { message: 'No IP on record.' } } });
    mount();
    await user.click(await screen.findByRole('button', { name: 'More for message: Where do we park?' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Block sender' }));
    expect(await screen.findByText('No IP on record.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More for message: Field two' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Block sender' })).toBeNull();
    asked.stop();
  });
});
