import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import type { StreamOverlay } from '../../types';
import { competition } from '../../test/factories';
import { deferred, liveStream } from '../../test/streamFakes';
import { ProducePage } from './ProducePage';
import { CurrentCompetitionProvider } from '../../competition/CurrentCompetitionContext';
import { TickerProvider } from '../../components/TickerContext';
import { TopBarTicker } from '../../components/TopBarTicker';

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
  expect(screen.getByRole('heading', { name: 'Only the organiser’s team can control the stream' })).toBeVisible();
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
  fireEvent.click(screen.getByRole('radio', { name: 'Toplist' }));
  await act(async () => {});
  expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent(outcome === 'conflict' ? 'The overlay changed on another phone. Check it and try again.' : 'Couldn’t change the overlay. Check your signal and try again.');
  expect(screen.getByRole('button', { name: outcome === 'conflict' ? 'Show me' : 'Try again' })).toBeVisible();
});

it('offers every overlay the Commentary desk has', () => {
  show();
  for (const name of ['Off', 'Toplist', 'Heat table', 'Podium', 'Race result', 'Up next', 'Favourites', 'Race title', 'Sponsors']) {
    expect(screen.getByRole('radio', { name })).toBeVisible();
  }
  expect(screen.queryByRole('radio', { name: 'Lanes' })).toBeNull();
});

it('serialises overlay saves and accepts subsequent changes from another device', async () => {
  const pending = deferred<'saved'>(); state.save.mockReturnValueOnce(pending.promise);
  const view = show(); fireEvent.click(screen.getByRole('radio', { name: 'Toplist' }));
  expect(screen.getByRole('radio', { name: 'Heat table' })).toBeDisabled();
  await act(async () => { pending.resolve('saved'); });
  state.overlay = { ...DEFAULT_OVERLAY, look: { liveCard: 'heat' } };
  view.rerender(<MemoryRouter><ProducePage /></MemoryRouter>);
  expect(screen.getByRole('radio', { name: 'Heat table' })).toHaveAttribute('aria-checked', 'true');
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

it('saves an overlay and a strip, and offers Try again when a camera command fails', async () => {
  show();
  fireEvent.click(screen.getByRole('radio', { name: 'Toplist' }));
  await act(async () => {});
  expect((state.overlay.look as Record<string, unknown>).liveCard).toBe('toplist');
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Live heat bar' }));
  await act(async () => {});
  expect(state.overlay.stripMode).toBe(2);

  vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: '2x Zoom' }));
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reach the camera phone. Check your signal and try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await act(async () => {});
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('moves the camera buttons into a sheet opened from the dock', async () => {
  render(<MemoryRouter><CurrentCompetitionProvider><TickerProvider><ProducePage /><TopBarTicker /></TickerProvider></CurrentCompetitionProvider></MemoryRouter>);
  expect(screen.queryByRole('link', { name: /Open camera on this phone/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Add 2nd camera/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Camera phones' }));
  const sheet = within(screen.getByRole('dialog', { name: 'Camera phones' }));
  expect(sheet.getByRole('link', { name: /Open camera on this phone/ })).toHaveAttribute('href', '/competitions/1/broadcast');
  fireEvent.click(sheet.getByRole('button', { name: /Add 2nd camera/ }));
  expect(sheet.getByRole('region', { name: /second camera/i })).toBeVisible();
});

it('puts nothing in the dock for viewers', () => {
  state.allowed = false;
  render(<MemoryRouter><CurrentCompetitionProvider><TickerProvider><ProducePage /><TopBarTicker /></TickerProvider></CurrentCompetitionProvider></MemoryRouter>);
  expect(screen.queryByRole('button', { name: 'Camera phones' })).toBeNull();
});
