import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import type { StreamOverlay } from '../../types';
import { competition } from '../../test/factories';
import { deferred, liveStream } from '../../test/streamFakes';
import { ProducePage } from './ProducePage';

const state = vi.hoisted(() => ({ allowed: true, admin: true, overlay: {} as StreamOverlay, save: vi.fn() }));
vi.mock('../../api', () => ({ api: { post: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => state.allowed, user: { fullName: 'Example Organiser', roles: state.admin ? ['Admin'] : ['Trainer'] } }) }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: competition(), streams: [liveStream({ id: 7 })], overlay: state.overlay, saveOverlay: state.save }) }));
const show = () => render(<MemoryRouter><ProducePage /></MemoryRouter>);
beforeEach(() => {
  state.allowed = true; state.admin = true; state.overlay = { ...DEFAULT_OVERLAY };
  state.save.mockImplementation(async (change: (o: StreamOverlay) => StreamOverlay) => { state.overlay = change(state.overlay); return 'saved'; });
  vi.mocked(api.post).mockResolvedValue({ data: {} });
});

it('hides producer actions from viewers', () => {
  state.allowed = false; show();
  expect(screen.queryByRole('button', { name: '2x Zoom' })).toBeNull();
  expect(screen.getByText(/Only the competition organiser/)).toBeVisible();
  expect(api.post).not.toHaveBeenCalled();
});

it('sends the server command names for camera zoom and quality', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: '2x Zoom' }));
  fireEvent.click(screen.getByRole('button', { name: '480p Saver' }));
  await act(async () => {});
  expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/7/command', { command: 'setZoom', value: '2' });
  expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/7/command', { command: 'setQualityPreset', value: '480p' });
});

it.each(['failed', 'conflict'])('does not claim or display an overlay saved after %s', async (outcome) => {
  state.save.mockResolvedValue(outcome); show();
  fireEvent.click(screen.getByRole('button', { name: 'Toplist' }));
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('status')).toHaveTextContent(/try again/i);
  expect(screen.getByRole('status')).not.toHaveTextContent('Showing toplist');
});

it('serialises overlay saves and accepts subsequent changes from another device', async () => {
  const pending = deferred<'saved'>(); state.save.mockReturnValueOnce(pending.promise);
  const view = show(); fireEvent.click(screen.getByRole('button', { name: 'Toplist' }));
  expect(screen.getByRole('button', { name: 'Lanes' })).toBeDisabled();
  await act(async () => { pending.resolve('saved'); });
  state.overlay = { ...DEFAULT_OVERLAY, look: { liveCard: 'heat' } };
  view.rerender(<MemoryRouter><ProducePage /></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'Heat table' })).toHaveAttribute('aria-pressed', 'true');
});

it('retains an unsaved banner and does not post a chat announcement on failure', async () => {
  state.save.mockResolvedValue('failed'); show();
  fireEvent.change(screen.getByLabelText('Banner message'), { target: { value: 'Example event starts soon' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post' })); await act(async () => {});
  expect(screen.getByLabelText('Banner message')).toHaveValue('Example event starts soon');
  expect(api.post).not.toHaveBeenCalled();
});

it('lets an organiser post a stream banner without calling the admin-only announcement route', async () => {
  state.admin = false; show();
  fireEvent.change(screen.getByLabelText('Banner message'), { target: { value: 'Example event starts soon' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post' })); await act(async () => {});
  expect(state.overlay.bannerText).toBe('Example event starts soon');
  expect(screen.getByLabelText('Banner message')).toHaveValue('');
  expect(api.post).not.toHaveBeenCalled();
});
