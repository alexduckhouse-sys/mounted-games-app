import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatTab } from './ChatTab';
import { api } from '../../api';
import { competition } from '../../test/factories';
import { flush } from '../../test/streamFakes';

const context = vi.hoisted(() => ({ enabled: false, organiser: true, edit: false, reload: vi.fn() }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: competition({ streamUrl: 'https://youtu.be/old', organiserName: 'Example Club', paymentDestination: 'Example payment instructions' }), reload: context.reload, streams: [], streamingEnabled: context.enabled, invoke: vi.fn(), ready: 1, streamMessages: [] }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: null, canEdit: () => context.edit, hasRole: () => false, canOrganise: () => context.organiser }) }));
vi.mock('../../live/useLiveHub', () => ({ useLiveHub: () => ({ connected: true }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() }); context.enabled = false; context.organiser = true; context.edit = false; vi.mocked(api.get).mockResolvedValue({ data: [] }); vi.mocked(api.put).mockResolvedValue({}); });
it('hides Go live until configured and only shows it to the organiser', async () => {
  const { rerender } = render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  expect(screen.queryByRole('link', { name: 'Go live' })).toBeNull();
  context.enabled = true; rerender(<MemoryRouter><ChatTab /></MemoryRouter>); expect(screen.getByRole('link', { name: 'Go live' })).toHaveAttribute('href', '/competitions/1/broadcast');
  context.organiser = false; rerender(<MemoryRouter><ChatTab /></MemoryRouter>); expect(screen.queryByRole('link', { name: 'Go live' })).toBeNull();
});
it('saves and clears only the stream URL using the dedicated endpoint', async () => {
  context.edit = true; render(<MemoryRouter><ChatTab /></MemoryRouter>); await act(flush);
  fireEvent.change(screen.getByPlaceholderText('https://youtu.be/… or https://twitch.tv/channel'), { target: { value: 'https://youtu.be/new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' })); await act(flush);
  expect(api.put).toHaveBeenCalledWith('/competitions/1/stream-url', { streamUrl: 'https://youtu.be/new' });
  fireEvent.click(screen.getByTitle('Clear stream')); await act(flush);
  expect(api.put).toHaveBeenLastCalledWith('/competitions/1/stream-url', { streamUrl: null }); expect(context.reload).toHaveBeenCalledTimes(2);
});
