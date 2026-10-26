import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatTab } from './ChatTab';
import { api } from '../../api';
import type { CompetitionDetail, LiveStream } from '../../types';
import { chat, competition, session } from '../../test/factories';
import { deferred, flush } from '../../test/streamFakes';

const context = vi.hoisted(() => ({ detail: null as CompetitionDetail | null, streams: [] as LiveStream[], enabled: false, organiser: true, roles: [] as string[], streamUrl: 'https://youtu.be/old' as string | null, messages: [] as unknown[], reload: vi.fn() }));
import { autoConfirm } from '../../test/confirm';
vi.mock('./context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./context')>()),
  useCompetition: () => ({ competition: context.detail ?? competition({ streamUrl: context.streamUrl, organiserName: 'Example Club', paymentDestination: 'Example payment instructions' }), reload: context.reload, streams: context.streams, streamingEnabled: context.enabled, invoke: vi.fn(), ready: 1, streamMessages: [] }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: context.roles.length > 0 ? { id: 'fake-user', roles: context.roles } : null, canEdit: () => context.roles.includes('Admin'), hasRole: (role: string) => context.roles.includes(role), canOrganise: () => context.organiser }) }));
vi.mock('../../live/useLiveHub', () => ({ useLiveHub: () => ({ connected: true }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() }); context.detail = null; context.streams = []; context.enabled = false; context.organiser = true; context.roles = ['Admin']; context.streamUrl = 'https://youtu.be/old'; context.messages = []; context.reload.mockReset(); vi.mocked(api.get).mockImplementation(async () => ({ data: context.messages })); vi.mocked(api.put).mockResolvedValue({}); vi.mocked(api.post).mockResolvedValue({}); vi.mocked(api.delete).mockResolvedValue({}); });
it('lets an admin or an owning trainer change the stream fallback, but not a trainer who cannot organise', async () => {
  const { rerender } = render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.getByText('Stream link is set')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Change' })).toBeVisible();
  context.roles = ['Trainer']; context.enabled = false; rerender(<MemoryRouter><ChatTab /></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'Change' })).toBeVisible();
  context.organiser = false; rerender(<MemoryRouter><ChatTab /></MemoryRouter>); expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
});

it('closes stream settings when the right to manage the stream is lost and does not reopen or save stale input', async () => {
  context.roles = ['Trainer'];
  const { rerender } = render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  fireEvent.change(screen.getByPlaceholderText('https://youtu.be/… or https://twitch.tv/channel'), { target: { value: 'https://youtu.be/stale' } });

  context.organiser = false;
  rerender(<MemoryRouter><ChatTab /></MemoryRouter>);
  expect(screen.queryByRole('dialog', { name: 'Stream settings' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(api.put).not.toHaveBeenCalled();

  context.organiser = true;
  rerender(<MemoryRouter><ChatTab /></MemoryRouter>);
  expect(screen.queryByRole('dialog', { name: 'Stream settings' })).toBeNull();
  expect(api.put).not.toHaveBeenCalled();
});
it('saves and clears only the stream URL using the dedicated endpoint', async () => {
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  fireEvent.change(screen.getByPlaceholderText('https://youtu.be/… or https://twitch.tv/channel'), { target: { value: 'https://youtu.be/new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' })); await act(flush);
  expect(api.put).toHaveBeenCalledWith('/competitions/1/stream-url', { streamUrl: 'https://youtu.be/new' });
  fireEvent.click(screen.getByTitle('Clear stream')); await act(flush);
  expect(api.put).toHaveBeenLastCalledWith('/competitions/1/stream-url', { streamUrl: null }); expect(context.reload).toHaveBeenCalledTimes(2);
});

it('shows a read-only latest-three feed, pinned banner and all-announcements sheet to the public without channel switcher or companion tabs', async () => {
  context.roles = [];
  context.streamUrl = null;
  context.messages = [
    chat(1, { body: 'Oldest update with enough detail that it must remain readable in the complete announcement list' }), chat(2, { body: 'Second update' }), chat(3, { body: 'Third update' }), chat(4, { body: 'Latest update' }),
    chat(5, { body: 'Parking is by the east gate', tag: 'banner' }),
  ];
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.getByText('Stream hasn’t started')).toBeVisible();
  expect(screen.getByText('Parking is by the east gate')).toBeVisible();
  expect(screen.getByText('Latest update')).toBeInTheDocument();
  expect(screen.queryByText(/Oldest update with enough detail/)).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('tablist', { name: 'Chat channels' })).toBeNull();
  expect(screen.queryByRole('tablist', { name: 'Stream companion view' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All 4' }));
  expect(screen.getByRole('dialog', { name: 'All announcements' })).toBeVisible();
  const fullMessage = screen.getByText(/Oldest update with enough detail/);
  expect(fullMessage).toBeVisible();
  expect(fullMessage.closest('.live-announcement-list-full')).not.toBeNull();
});

it('only shows the top Live badge on the public page when an active stream is running', async () => {
  context.roles = [];
  context.streamUrl = null;
  context.detail = competition({ sessions: [session(1, { status: 1 })] });
  const { rerender } = render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.queryByText('Live')).toBeNull();

  context.streams = [{
    id: 1,
    competitionId: 1,
    arenaName: 'Main Arena',
    angleName: 'Main camera',
    status: 0,
    caption: null,
    audioMuted: false,
    hasAudio: true,
    startedAt: '2026-06-01T10:00:00Z',
    viewerCount: 12,
    generation: 1,
  }];
  rerender(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.getByText('Live')).toHaveClass('mg-badge-live');
});

it('links non-admin trainers to the dedicated Message organisers page instead of showing a channel tab on Live stream', async () => {
  context.roles = ['Trainer'];
  context.organiser = false;
  context.detail = competition({ staffChatEnabled: true });
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.queryByRole('tab', { name: 'Message Organisers' })).toBeNull();
  expect(screen.getByRole('link', { name: /Message organisers/i })).toHaveAttribute('href', '/competitions/1/contact');
});

it('shows announcements at the top first, pins any announcement after the fact, and lets a more recent announcement replace the pin', async () => {
  context.messages = [
    chat(8, { body: 'Morning briefing at 9am', createdAt: '2026-06-01T09:00:00Z' }),
    chat(9, { body: 'Lunch break now', createdAt: '2026-06-01T12:00:00Z' }),
  ];
  vi.mocked(api.post).mockResolvedValueOnce({
    data: chat(10, { body: 'Morning briefing at 9am', tag: 'banner', type: 2, createdAt: '2026-06-01T12:05:00Z' }),
  });
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);

  // Latest announcement appears in the top banner first
  expect(screen.getByRole('status', { name: 'Top announcement' })).toHaveTextContent('Lunch break now');

  // Pinning the older announcement after the fact replaces the top banner
  fireEvent.click(screen.getByRole('button', { name: 'Pin as banner: Morning briefing at 9am' })); await act(flush);
  expect(api.post).toHaveBeenCalledWith('/competitions/1/chat/announcement', { body: 'Morning briefing at 9am', tag: 'banner' });
  expect(screen.getByRole('status', { name: 'Top announcement' })).toHaveTextContent('Morning briefing at 9am');

  // Posting a more recent announcement replaces the pinned banner at the top
  vi.mocked(api.post).mockResolvedValueOnce({
    data: chat(11, { body: 'Finals starting in Arena 1', tag: 'general', type: 2, createdAt: '2026-06-01T14:00:00Z' }),
  });
  fireEvent.change(screen.getByPlaceholderText('Write an announcement…'), { target: { value: 'Finals starting in Arena 1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await act(flush);
  expect(screen.getByRole('status', { name: 'Top announcement' })).toHaveTextContent('Finals starting in Arena 1');
});

it('keeps the existing banner when its replacement fails and serialises duplicate pin clicks', async () => {
  context.messages = [chat(7, { body: 'Example replacement' }), chat(8, { body: 'Existing banner', tag: 'banner' })];
  const pending = deferred<never>();
  vi.mocked(api.post).mockReturnValueOnce(pending.promise);
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  const pin = screen.getByRole('button', { name: 'Pin as banner: Example replacement' });
  fireEvent.click(pin); fireEvent.click(pin);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.delete).not.toHaveBeenCalled();
  await act(async () => { pending.reject(new Error('Synthetic offline failure')); await flush(); });
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t pin');
  expect(screen.getByRole('status', { name: 'Top announcement' })).toHaveTextContent('Existing banner');
  expect(api.delete).not.toHaveBeenCalled();
});

it('retains the saved replacement and reports a failure to delete the old banner', async () => {
  context.messages = [chat(7, { body: 'Example replacement' }), chat(8, { body: 'Existing banner', tag: 'banner' })];
  vi.mocked(api.post).mockResolvedValueOnce({ data: chat(9, { body: 'Example replacement', tag: 'banner' }) });
  vi.mocked(api.delete).mockRejectedValueOnce(new Error('Synthetic offline failure'));
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.click(screen.getByRole('button', { name: 'Pin as banner: Example replacement' })); await act(flush);
  expect(vi.mocked(api.post).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.delete).mock.invocationCallOrder[0]);
  expect(screen.getByRole('status', { name: 'Top announcement' })).toHaveTextContent('Example replacement');
  expect(screen.getByRole('alert')).toHaveTextContent('old banner could not be cleared');
});

it('orders out-of-order messages and uses IDs to break equal timestamp ties', async () => {
  const createdAt = '2026-06-01T12:00:00Z';
  context.messages = [
    chat(12, { body: 'New announcement', createdAt }),
    chat(11, { body: 'Earlier pin', tag: 'banner', createdAt }),
    chat(10, { body: 'Old announcement', createdAt: '2026-06-01T11:00:00Z' }),
  ];
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.getByRole('status', { name: 'Top announcement' })).toHaveTextContent('New announcement');
  expect(screen.getByRole('button', { name: 'Pin as banner: New announcement' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Hide on this device' }));
  expect(screen.queryByRole('status', { name: 'Top announcement' })).toBeNull();
  expect(screen.getByText('New announcement')).toBeVisible();
  expect(api.delete).not.toHaveBeenCalled();
});

it('never promotes a private message tagged as a banner into the public announcement area', async () => {
  context.roles = [];
  context.messages = [chat(1, { body: 'Public example' }), chat(2, { body: 'Private example', adminOnly: true, tag: 'banner' })];
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.queryByText('Private example')).toBeNull();
  expect(screen.getByRole('status', { name: 'Top announcement' })).toHaveTextContent('Public example');
});

it('marks only the selected announcement as pinned when two announcements have the same text', async () => {
  context.messages = [chat(1, { body: 'Repeated example' }), chat(2, { body: 'Repeated example' })];
  vi.mocked(api.post).mockResolvedValueOnce({ data: chat(3, { body: 'Repeated example', tag: 'banner' }) });
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.click(screen.getAllByRole('button', { name: 'Pin as banner: Repeated example' })[1]); await act(flush);
  expect(screen.getAllByRole('button', { name: 'Unpin: Repeated example' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Pin as banner: Repeated example' })).toHaveLength(1);
});

it('offers camera controls to competition collaborators without granting global chat moderation', async () => {
  context.roles = ['Member']; context.organiser = true; context.enabled = true;
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.getByRole('link', { name: 'Go live' })).toHaveAttribute('href', '/competitions/1/broadcast');
  expect(screen.queryByRole('textbox', { name: 'Announcement' })).toBeNull();
});

it('shows send and unpin failures without leaving rejected action promises', async () => {
  context.roles = ['Admin'];
  vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
  const { unmount } = render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.change(screen.getByPlaceholderText('Write an announcement…'), { target: { value: 'Is the briefing moving?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t send that post');
  unmount();

  context.roles = ['Admin']; context.messages = [chat(9, { body: 'Pinned note', tag: 'banner' })];
  vi.mocked(api.delete).mockRejectedValueOnce(new Error('offline'));
  const adminView = render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t unpin the banner');
  adminView.unmount();

  context.messages = [chat(10, { body: 'General update' })];
  vi.mocked(api.delete).mockRejectedValueOnce(new Error('offline'));
  autoConfirm([true]);
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.click(screen.getByRole('button', { name: 'Delete: General update' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t delete that announcement');
});

it('lets an admin post an announcement straight away, with no edit mode note', async () => {
  context.roles = ['Admin'];
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.queryByText(/Edit mode/i)).toBeNull();
  fireEvent.change(screen.getByPlaceholderText('Write an announcement…'), { target: { value: 'Briefing at nine' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await act(flush);
  expect(api.post).toHaveBeenCalled();
});

it('gives organisers a clear Go live button, whether or not streaming is switched on', async () => {
  context.roles = ['Admin']; context.enabled = true;
  const { rerender } = render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  const goLive = screen.getByRole('link', { name: 'Go live' });
  expect(goLive).toHaveAttribute('href', '/competitions/1/broadcast');
  expect(screen.queryByText(/Streaming isn’t set up yet/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Control the stream' })).toHaveAttribute('href', '/competitions/1/stream-controls');
  expect(screen.getByRole('link', { name: 'Commentary desk' })).toHaveAttribute('href', '/competitions/1/commentary');
  expect(screen.queryByText('End stream')).toBeNull();

  context.enabled = false; rerender(<MemoryRouter><ChatTab /></MemoryRouter>);
  expect(screen.queryByRole('link', { name: 'Go live' })).toBeNull();
  expect(screen.getByText('Streaming isn’t set up yet. Add the Cloudflare keys to switch it on.')).toBeVisible();
});

it('hides Go live once a stream is on but keeps the control and desk links', async () => {
  context.roles = ['Admin']; context.enabled = true;
  context.streams = [{ id: 4, competitionId: 1, arenaName: 'Arena 1', angleName: 'Main', status: 0, caption: null, audioMuted: false, hasAudio: true, startedAt: '2026-06-01T10:00:00Z', viewerCount: 2, generation: 1 }];
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.queryByRole('link', { name: 'Go live' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Control the stream' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Commentary desk' })).toBeInTheDocument();
});

it('does not tell the public streaming is not set up', async () => {
  context.roles = [];
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.queryByText(/Streaming isn’t set up yet/)).toBeNull();
  expect(screen.queryByRole('link', { name: /Go live/ })).toBeNull();
});

it('shows a failed announcement load separately and retries it', async () => {
  context.roles = [];
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [chat(2, { body: 'Racing resumes at two' })] });
  render(<MemoryRouter><ChatTab /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the announcements');
  expect(screen.queryByText('Nothing posted yet.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect((await screen.findAllByText('Racing resumes at two'))[0]).toBeVisible();
});

it('traps focus in the announcement sheet and restores the All button', async () => {
  context.roles = [];
  context.messages = [chat(1, { body: 'One' }), chat(2, { body: 'Two' })];
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  const opener = screen.getByRole('button', { name: 'All 2' });
  fireEvent.click(opener);
  const close = screen.getByRole('button', { name: 'Close announcements' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(opener).toHaveFocus());
});

it('reports stream-link failures, preserves the input and restores focus on close', async () => {
 
  vi.mocked(api.put).mockRejectedValue(new Error('offline'));
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  const opener = screen.getByRole('button', { name: 'Change' });
  fireEvent.click(opener);
  const close = screen.getByRole('button', { name: 'Close stream settings' });
  expect(close).toHaveFocus();
  const input = screen.getByPlaceholderText('https://youtu.be/… or https://twitch.tv/channel');
  fireEvent.click(screen.getByTitle('Clear stream'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the stream link');
  expect(input).toHaveValue('https://youtu.be/old');
  fireEvent.change(input, { target: { value: 'https://youtu.be/new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the stream link');
  expect(input).toHaveValue('https://youtu.be/new');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(opener).toHaveFocus());
});
