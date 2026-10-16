import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { BroadcastPage } from './BroadcastPage';
import type { PublisherSnapshot } from '../../live/streamPublisher';
import { setBroadcasting } from '../../pwa';
import { competition, session } from '../../test/factories';
import { asMedia, deferred, FakeMediaStream, fakePeerConstructor, FakeTrack, flush } from '../../test/streamFakes';

const state = vi.hoisted(() => ({ organiser: true, enabled: true, snapshot: {} as PublisherSnapshot, listener: () => {} }));
const publisher = vi.hoisted(() => ({
  getSnapshot: () => state.snapshot,
  subscribe: (listener: () => void) => { state.listener = listener; return () => {}; },
  capture: vi.fn(), devices: vi.fn(), switchCamera: vi.fn(), start: vi.fn(), stop: vi.fn(), dispose: vi.fn(), mute: vi.fn(), pause: vi.fn(), caption: vi.fn(), viewers: vi.fn(),
}));
vi.mock('../../live/streamPublisher', () => ({ browserPublisherDependencies: () => ({}), createStreamPublisher: () => publisher }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: competition({ sessions: [session(1, { arenaName: 'Main Arena' }), session(2, { arenaName: 'Second Arena' })] }), streamingEnabled: state.enabled, streams: [], streamMessages: [] }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => state.organiser }) }));
vi.mock('../../pwa', () => ({ setBroadcasting: vi.fn() }));
const update = (patch: Partial<PublisherSnapshot>) => { state.snapshot = { ...state.snapshot, ...patch }; state.listener(); };
const show = () => render(<MemoryRouter initialEntries={['/competitions/1/broadcast']}><BroadcastPage /></MemoryRouter>);
const settle = () => act(flush);
beforeEach(() => {
  state.organiser = true; state.enabled = true;
  state.snapshot = { state: 'idle', media: null, streamId: null, viewerCount: 0, signal: 'good', audioMuted: false, hasAudio: false, error: null };
  vi.stubGlobal('RTCPeerConnection', fakePeerConstructor);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  publisher.capture.mockImplementation(async (sound: boolean) => update({ media: asMedia(new FakeMediaStream([new FakeTrack()])), hasAudio: sound }));
  publisher.devices.mockResolvedValue([{ deviceId: 'usb', label: 'USB capture' }]);
  publisher.start.mockImplementation(async () => update({ state: 'live', streamId: 1 }));
  publisher.stop.mockImplementation(async () => update({ state: 'ended', media: null }));
  publisher.pause.mockImplementation(async (paused: boolean) => update({ state: paused ? 'paused' : 'live' }));
  publisher.mute.mockImplementation(async (muted: boolean) => update({ audioMuted: muted }));
});
it('checks ownership, configuration and browser support before opening a camera', () => {
  state.organiser = false; const { rerender } = show(); expect(screen.getByText('Only the organiser can broadcast.')).toBeVisible();
  state.organiser = true; state.enabled = false; rerender(<MemoryRouter><BroadcastPage /></MemoryRouter>); expect(screen.getByText(/not set up/)).toBeVisible();
  state.enabled = true; vi.stubGlobal('RTCPeerConnection', undefined); rerender(<MemoryRouter><BroadcastPage /></MemoryRouter>); expect(screen.getByText(/cannot broadcast/)).toBeVisible();
  expect(publisher.capture).not.toHaveBeenCalled();
});
it('captures from a tap, lists capture inputs, supports named arenas and angles and warns about public filming', async () => {
  show(); expect(publisher.capture).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox')); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle(); expect(publisher.capture).toHaveBeenCalledWith(false);
  expect(screen.getByRole('option', { name: 'USB capture' })).toBeVisible(); expect(screen.getByText(/Check families know/)).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Camera' }), { target: { value: 'usb' } }); await settle(); expect(publisher.switchCamera).toHaveBeenCalledWith('usb');
  fireEvent.click(screen.getByRole('button', { name: 'Flip camera' })); await settle(); expect(publisher.switchCamera).toHaveBeenLastCalledWith();
  fireEvent.click(screen.getAllByRole('button', { name: 'Other…' })[0]);
  fireEvent.change(screen.getByRole('textbox', { name: 'Arena name' }), { target: { value: 'Practice' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Other…' })[1]);
  fireEvent.change(screen.getByRole('textbox', { name: 'Camera position' }), { target: { value: 'Gate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go live' })); await settle(); expect(publisher.start).toHaveBeenCalledWith('Practice', 'Gate');
  expect(setBroadcasting).toHaveBeenCalledWith(true);
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
it('can confirm End while initial publishing is still pending', async () => {
  const pending = deferred<void>(); publisher.start.mockImplementation(() => { update({ state: 'starting' }); return pending.promise; });
  show(); fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Go live' })); await settle(); expect(screen.getByText('Starting stream…')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'End' })); expect(screen.getByRole('button', { name: 'End stream' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'End stream' })); await settle(); expect(publisher.stop).toHaveBeenCalled();
  await act(async () => { pending.resolve(); await flush(); }); expect(setBroadcasting).toHaveBeenCalledWith(false);
});
it('offers mute, pause/resume and a caption that can be cleared', async () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Go live' })); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Sound on' })); await settle(); expect(publisher.mute).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Back soon' })); await settle(); expect(screen.getByText('Viewers see Back soon')).toBeVisible();
  fireEvent.click(screen.getAllByRole('button', { name: 'Resume' })[0]); await settle(); expect(publisher.pause).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: /Viewers see/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Viewers see' }), { target: { value: 'Final A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' })); await settle(); expect(publisher.caption).toHaveBeenCalledWith('Final A');
  fireEvent.click(screen.getByRole('button', { name: /Viewers see/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Viewers see' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' })); await settle(); expect(publisher.caption).toHaveBeenLastCalledWith('');
});
