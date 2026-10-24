import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatTab } from './ChatTab';
import { api } from '../../api';
import type { CompetitionDetail, LiveStream } from '../../types';
import { chat, competition, session } from '../../test/factories';
import { flush } from '../../test/streamFakes';

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

it('keeps trainer posts private through the existing chat endpoint', async () => {
  context.roles = ['Trainer'];
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.click(screen.getByRole('tab', { name: 'Message Organisers' }));
  fireEvent.change(screen.getByPlaceholderText('Message the organisers…'), { target: { value: 'Can we move our briefing?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await act(flush);
  expect(api.post).toHaveBeenCalledWith('/competitions/1/chat', { body: 'Can we move our briefing?' });
  expect(screen.queryByRole('button', { name: 'Pin as banner' })).toBeNull();
});

it('replaces the existing banner when an admin pins another one', async () => {
 
  context.messages = [chat(8, { body: 'Old banner', tag: 'banner' })];
  vi.mocked(api.post).mockResolvedValueOnce({ data: chat(9, { body: 'New banner', tag: 'banner' }) });
  render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.click(screen.getByRole('button', { name: 'Pin as banner' }));
  fireEvent.change(screen.getByPlaceholderText('Banner text, replaces the pinned one'), { target: { value: 'New banner' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await act(flush);
  expect(api.delete).toHaveBeenCalledWith('/competitions/1/chat/8');
  expect(api.post).toHaveBeenCalledWith('/competitions/1/chat/announcement', { body: 'New banner', tag: 'banner' });
  expect(screen.getByText('New banner')).toBeVisible();
  expect(screen.queryByText('Old banner')).toBeNull();
  expect(context.reload).toHaveBeenCalledOnce();
});

it('shows send and unpin failures without leaving rejected action promises', async () => {
  context.roles = ['Trainer'];
  vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
  const { unmount } = render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.click(screen.getByRole('tab', { name: 'Message Organisers' }));
  fireEvent.change(screen.getByPlaceholderText('Message the organisers…'), { target: { value: 'Is the briefing moving?' } });
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
  const goLive = screen.getByRole('link', { name: /Go live from this device/ });
  expect(goLive).toHaveAttribute('href', '/competitions/1/broadcast');
  expect(screen.queryByText(/Streaming isn’t set up yet/)).toBeNull();

  context.enabled = false; rerender(<MemoryRouter><ChatTab /></MemoryRouter>);
  expect(screen.queryByRole('link', { name: /Go live from this device/ })).toBeNull();
  expect(screen.getByText('Streaming isn’t set up yet. Add the Cloudflare keys to switch it on.')).toBeVisible();
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
  expect(await screen.findByText('Racing resumes at two')).toBeVisible();
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
