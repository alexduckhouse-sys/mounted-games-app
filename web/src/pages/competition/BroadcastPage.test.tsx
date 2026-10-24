import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { BroadcastPage } from './BroadcastPage';
import { ProducePage } from './ProducePage';
import type { PublisherSnapshot } from '../../live/streamPublisher';
import type { StreamOverlay } from '../../types';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { setBroadcasting } from '../../pwa';
import { competition, session } from '../../test/factories';
import { asMedia, deferred, FakeMediaStream, fakePeerConstructor, FakeTrack, flush } from '../../test/streamFakes';
import { chooseOption, optionLabels } from '../../test/select';

const state = vi.hoisted(() => ({
  organiser: true,
  enabled: true,
  snapshot: {} as PublisherSnapshot,
  listener: () => {},
  streams: [] as unknown[],
  overlay: undefined as StreamOverlay | undefined,
  saveOverlay: vi.fn(async (change: (o: StreamOverlay) => StreamOverlay) => {
    if (state.overlay) state.overlay = change(state.overlay);
    return 'saved' as const;
  }),
}));
const publisher = vi.hoisted(() => ({
  getSnapshot: () => state.snapshot,
  subscribe: (listener: () => void) => { state.listener = listener; return () => {}; },
  capture: vi.fn(), devices: vi.fn(), switchCamera: vi.fn(), start: vi.fn(), stop: vi.fn(), dispose: vi.fn(), mute: vi.fn(), pause: vi.fn(), caption: vi.fn(), viewers: vi.fn(),
}));
vi.mock('../../live/streamPublisher', () => ({ browserPublisherDependencies: () => ({}), createStreamPublisher: () => publisher }));
vi.mock('./context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./context')>()),
  useCompetition: () => ({
    competition: competition({ sessions: [session(1, { arenaName: 'Main Arena' }), session(2, { arenaName: 'Second Arena' })] }),
    streamingEnabled: state.enabled,
    streams: state.streams,
    streamMessages: [],
    overlay: state.overlay,
    saveOverlay: state.saveOverlay,
  }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => state.organiser }) }));
vi.mock('../../pwa', () => ({ setBroadcasting: vi.fn() }));
const update = (patch: Partial<PublisherSnapshot>) => { state.snapshot = { ...state.snapshot, ...patch }; state.listener(); };
const show = () => render(<MemoryRouter initialEntries={['/competitions/1/broadcast']}><BroadcastPage /></MemoryRouter>);
const settle = () => act(flush);
beforeEach(() => {
  state.organiser = true; state.enabled = true; state.streams = [];
  state.overlay = { ...DEFAULT_OVERLAY };
  state.saveOverlay.mockClear();
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
  expect(optionLabels(screen.getByRole('combobox', { name: 'Camera' }))).toContain('USB capture'); expect(screen.getByText(/Check families know/)).toBeVisible();
  chooseOption(screen.getByRole('combobox', { name: 'Camera' }), 'usb'); await settle(); expect(publisher.switchCamera).toHaveBeenCalledWith('usb');
  fireEvent.click(screen.getByRole('button', { name: 'Flip camera' })); await settle(); expect(publisher.switchCamera).toHaveBeenLastCalledWith();
  fireEvent.click(screen.getAllByRole('button', { name: 'Other…' })[0]);
  fireEvent.change(screen.getByRole('textbox', { name: 'Arena name' }), { target: { value: 'Practice' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Other…' })[1]);
  fireEvent.change(screen.getByRole('textbox', { name: 'Camera position' }), { target: { value: 'Gate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go live' })); await settle(); expect(publisher.start).toHaveBeenCalledWith('Practice', 'Gate', false);
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
it('offers to take over when the same arena and camera position is already live', async () => {
  state.streams = [{ id: 7, competitionId: 1, arenaName: 'main arena ', angleName: 'Main camera', status: 0 }, { id: 8, competitionId: 1, arenaName: 'Main Arena', angleName: 'Wide', status: 2 }];
  show(); fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  expect(screen.getByText(/Someone is already streaming Main Arena · Main camera/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
  expect(screen.queryByText(/already streaming/)).toBeNull(); expect(screen.getByRole('button', { name: 'Go live' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Main camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Take over and go live' })); await settle();
  expect(publisher.start).toHaveBeenCalledWith('Main Arena', 'Main camera', true);
});
it('toggles the live score strip and sends or clears banner messages inline', async () => {
  const { rerender } = show();
  const stripToggle = screen.getByRole('button', { name: 'Show live score strip' });
  expect(stripToggle).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(stripToggle); await settle();
  expect(state.overlay).toMatchObject({ stripMode: 2, scoreCardMode: 2 });

  fireEvent.change(screen.getByRole('textbox', { name: 'Banner message' }), { target: { value: '  Lunch break until 1pm  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Put on air' })); await settle();
  expect(state.overlay).toMatchObject({ bannerText: 'Lunch break until 1pm', bannerStyle: 1 });

  rerender(<MemoryRouter initialEntries={['/competitions/1/broadcast']}><BroadcastPage /></MemoryRouter>);
  expect(screen.getByText('On air: Lunch break until 1pm')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear banner' })); await settle();
  expect(state.overlay?.bannerText).toBeNull();
});
it('redirects ProducePage to BroadcastPage', () => {
  render(
    <MemoryRouter initialEntries={['/competitions/1/produce']}>
      <Routes>
        <Route path="/competitions/:id/produce" element={<ProducePage />} />
        <Route path="/competitions/:id/broadcast" element={<BroadcastPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Go live' })).toBeVisible();
});
