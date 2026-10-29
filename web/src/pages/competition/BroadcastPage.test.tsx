import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
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
  lastStreamCommand: null as unknown,
  saveOverlay: vi.fn(async (change: (o: StreamOverlay) => StreamOverlay) => {
    if (state.overlay) state.overlay = change(state.overlay);
    return 'saved' as const;
  }),
}));
const publisher = vi.hoisted(() => ({
  getSnapshot: () => state.snapshot,
  subscribe: (listener: () => void) => { state.listener = listener; return () => {}; },
  capture: vi.fn(), devices: vi.fn(), audioDevices: vi.fn(async (): Promise<MediaDeviceInfo[]> => []), switchCamera: vi.fn(), switchAudio: vi.fn(),
  setWindFilter: vi.fn(), setZoom: vi.fn(), setQualityPreset: vi.fn(), reconnect: vi.fn(),
  start: vi.fn(), stop: vi.fn(), dispose: vi.fn(), mute: vi.fn(), pause: vi.fn(), caption: vi.fn(), viewers: vi.fn(),
  watchDevices: vi.fn(), setCameraLock: vi.fn(),
}));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../live/streamPublisher', () => ({ browserPublisherDependencies: () => ({}), createStreamPublisher: () => publisher }));
vi.mock('./context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./context')>()),
  useCompetition: () => ({
    competition: competition({ sessions: [session(1, { arenaName: 'Main Arena' }), session(2, { arenaName: 'Second Arena' })] }),
    streamingEnabled: state.enabled,
    streams: state.streams,
    streamMessages: [],
    overlay: state.overlay,
    lastStreamCommand: state.lastStreamCommand,
    saveOverlay: state.saveOverlay,
  }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', fullName: 'Alex Organiser', roles: ['Admin'] }, canOrganise: () => state.organiser }),
}));
vi.mock('../../pwa', () => ({ setBroadcasting: vi.fn() }));
const update = (patch: Partial<PublisherSnapshot>) => { state.snapshot = { ...state.snapshot, ...patch }; state.listener(); };
const show = () => render(<MemoryRouter initialEntries={['/competitions/1/broadcast']}><BroadcastPage /></MemoryRouter>);
const settle = () => act(flush);
beforeEach(() => {
  state.organiser = true; state.enabled = true; state.streams = [];
  state.overlay = { ...DEFAULT_OVERLAY };
  state.saveOverlay.mockClear();
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
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
  publisher.watchDevices.mockReset().mockReturnValue(vi.fn());
  publisher.setCameraLock.mockReset().mockResolvedValue(undefined);
});
it('refreshes the camera and microphone lists when a device is plugged in, and stops listening on the way out', async () => {
  const stopWatching = vi.fn();
  let changed: (cameras: MediaDeviceInfo[], microphones: MediaDeviceInfo[]) => void = () => {};
  publisher.watchDevices.mockImplementation((listener: typeof changed) => { changed = listener; return stopWatching; });
  const view = show();
  expect(publisher.watchDevices).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  expect(publisher.watchDevices).toHaveBeenCalledOnce();
  act(() => changed([{ deviceId: 'usb', label: 'USB capture' }, { deviceId: 'hdmi', label: 'HDMI capture' }] as MediaDeviceInfo[], [{ deviceId: 'lapel', label: 'Lapel mic' }] as MediaDeviceInfo[]));
  expect(optionLabels(screen.getByRole('combobox', { name: 'Camera' }))).toContain('HDMI capture');
  expect(optionLabels(screen.getByRole('combobox', { name: 'Microphone' }))).toContain('Lapel mic');
  view.unmount();
  expect(stopWatching).toHaveBeenCalledOnce();
});
it('offers the camera locks the camera reports and applies them', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  expect(screen.queryByRole('group', { name: 'Camera locks' })).toBeNull();
  act(() => update({ cameraLocks: { exposure: false, focus: true } }));
  expect(screen.getByRole('button', { name: 'Lock focus' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Lock exposure' })); await settle();
  expect(publisher.setCameraLock).toHaveBeenCalledWith('exposure', true);
  publisher.setCameraLock.mockRejectedValueOnce(new Error('refused'));
  fireEvent.click(screen.getByRole('button', { name: 'Lock focus' })); await settle();
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t complete that change');
});
afterEach(() => { vi.useRealTimers(); });
it('checks ownership, configuration and browser support before opening a camera', () => {
  state.organiser = false; const { rerender } = show(); expect(screen.getByRole('heading', { name: 'Only the organiser’s team can go live' })).toBeVisible(); expect(screen.getByRole('link', { name: 'Back to competition' })).toHaveAttribute('href', '/competitions/1');
  state.organiser = true; state.enabled = false; rerender(<MemoryRouter><BroadcastPage /></MemoryRouter>); expect(screen.getByText(/not set up/)).toBeVisible();
  state.enabled = true; vi.stubGlobal('RTCPeerConnection', undefined); rerender(<MemoryRouter><BroadcastPage /></MemoryRouter>); expect(screen.getByText(/cannot broadcast/)).toBeVisible();
  expect(publisher.capture).not.toHaveBeenCalled();
});
it('captures from a tap, lists capture inputs, supports named arenas and angles and warns about public filming', async () => {
  show(); expect(publisher.capture).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '‹ Live stream' })).toHaveAttribute('href', '/competitions/1/chat');
  expect(screen.queryByRole('region', { name: 'Stream overlays' })).toBeNull();
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
it('asks before ending the stream and carries on when told to keep going', async () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Go live' })); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'End' })); await settle();
  const dialog = screen.getByRole('alertdialog', { name: 'End the stream?' });
  expect(dialog).toHaveTextContent('Viewers will see that it has finished.');
  fireEvent.click(screen.getByRole('button', { name: 'Keep going' })); await settle();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(publisher.stop).not.toHaveBeenCalled();
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
it('names the person who is already streaming that angle, once the API says who', async () => {
  state.streams = [{ id: 7, competitionId: 1, arenaName: 'Main Arena', angleName: 'Main camera', status: 0 }];
  vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url.endsWith('/streams/publishers') ? [{ streamId: 7, startedByName: ' Jo Bloggs ' }, { streamId: 9, startedByName: null }] : [] }));
  show(); fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  expect(screen.getByText(/Jo Bloggs is already streaming Main Arena · Main camera/)).toBeVisible();
  expect(screen.queryByText(/Someone is already streaming/)).toBeNull();
  expect(api.get).toHaveBeenCalledWith('/competitions/1/streams/publishers');
});
it('says someone when the API has no name for the streamer, or the lookup fails', async () => {
  state.streams = [{ id: 7, competitionId: 1, arenaName: 'Main Arena', angleName: 'Main camera', status: 0 }];
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.endsWith('/streams/publishers')) throw new Error('offline');
    return { data: [] };
  });
  show(); fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  expect(screen.getByText(/Someone is already streaming Main Arena · Main camera/)).toBeVisible();
});
it('posts live banner announcements, clears banners, and switches overlays from the live camera screen', async () => {
  const { rerender } = show();
  fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Go live' })); await settle();

  fireEvent.click(screen.getByRole('button', { name: 'Announce' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Banner message' }), { target: { value: '  Lunch break until 1pm  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post' })); await settle();
  expect(state.overlay).toMatchObject({ bannerText: 'Lunch break until 1pm', bannerStyle: 0 });
  expect(api.post).toHaveBeenCalledWith('/competitions/1/chat/announcement', {
    body: 'Lunch break until 1pm',
    message: 'Lunch break until 1pm',
    author: 'Alex Organiser',
    tag: 'banner',
  });

  rerender(<MemoryRouter initialEntries={['/competitions/1/broadcast']}><BroadcastPage /></MemoryRouter>);
  expect(screen.getByRole('status', { name: 'Lunch break until 1pm' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear banner' })); await settle();
  expect(state.overlay?.bannerText).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Overlays' }));
  expect(screen.getByRole('region', { name: 'Live overlays' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Toplist' })); await settle();
  expect(state.overlay?.look).toMatchObject({ liveCard: 'toplist' });

  fireEvent.click(screen.getByRole('button', { name: 'Score strip' })); await settle();
  expect(state.overlay?.scoreCardMode).toBe(2);

  fireEvent.click(screen.getByRole('button', { name: 'Live heat bar' })); await settle();
  expect(state.overlay?.stripMode).toBe(2);
});
it('shows remaining free-plan stream time, allows +15m extension, and auto-stops when time expires', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Allow camera' })); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Go live' })); await settle();

  expect(screen.getByText('30:00 left')).toBeVisible();
  act(() => { vi.advanceTimersByTime(15_000); });
  expect(screen.getByText('29:45 left')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: '+15m' }));
  expect(screen.getByText('44:45 left')).toBeVisible();
  expect(screen.getByRole('button', { name: '+15m' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '+15m' }));
  expect(screen.getByText('44:45 left')).toBeVisible();

  await act(async () => {
    vi.advanceTimersByTime(44 * 60 * 1000 + 45 * 1000);
    await flush();
  });
  expect(publisher.stop).toHaveBeenCalledTimes(1);
});
it('renders ProducePage as the 2nd phone remote stream controller and dual-camera switcher', async () => {
  state.streams = [
    { id: 1, competitionId: 1, arenaName: 'Main Arena', angleName: 'Main camera', status: 0, viewerCount: 5 },
    { id: 2, competitionId: 1, arenaName: 'Main Arena', angleName: 'Finish line', status: 0, viewerCount: 3 },
  ];
  render(
    <MemoryRouter initialEntries={['/competitions/1/produce']}>
      <Routes>
        <Route path="/competitions/:id/produce" element={<ProducePage />} />
        <Route path="/competitions/:id/broadcast" element={<BroadcastPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Remote stream controller' })).toBeVisible();

  // Pair 2nd camera phone QR modal
  fireEvent.click(screen.getByRole('button', { name: /Add 2nd camera phone/i }));
  expect(screen.getByRole('region', { name: 'Add second camera phone' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Changeover line' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  // Switch active camera angle
  fireEvent.click(screen.getByRole('button', { name: 'Cut to angle' }));
  await settle();
  expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/2/command', {
    command: 'selectAngle',
    value: '2',
  });

  // Remote camera controls from 2nd phone
  fireEvent.click(screen.getByRole('button', { name: '2x Zoom' }));
  await settle();
  expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/2/command', {
    command: 'setZoom',
    value: '2',
  });

  fireEvent.click(screen.getByRole('button', { name: '480p Saver' }));
  await settle();
  expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/2/command', {
    command: 'setQualityPreset',
    value: '480p',
  });

  fireEvent.click(screen.getByRole('button', { name: 'Save 15s replay' }));
  await settle();
  expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/2/command', {
    command: 'saveReplay',
    value: '15',
  });

  // Centred overlay triggers from 2nd phone
  fireEvent.click(screen.getByRole('radio', { name: 'Toplist' }));
  await settle();
  expect(state.overlay?.look).toMatchObject({ liveCard: 'toplist' });

  fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
  await settle();
  expect(state.overlay?.look).toMatchObject({ liveCard: 'none' });

  // Live announcement banner from 2nd phone
  fireEvent.change(screen.getByLabelText('Banner message'), { target: { value: 'Next heat in arena' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await settle();
  expect(state.overlay?.bannerText).toBe('Next heat in arena');
});
it('supports microphone selection, wind filter, quality presets, camera zoom, tripod screen dimming, multi-camera director cut, and remote commands', async () => {
  publisher.audioDevices.mockResolvedValue([{ deviceId: 'rodelink', label: 'Rode Wireless GO' } as MediaDeviceInfo]);
  state.streams = [
    { id: 1, competitionId: 1, arenaName: 'Main Arena', angleName: 'Main camera', status: 0, viewerCount: 5 },
    { id: 2, competitionId: 1, arenaName: 'Main Arena', angleName: 'Finish line', status: 0, viewerCount: 3 },
  ];
  state.lastStreamCommand = null;
  const { rerender } = show();
  fireEvent.click(screen.getByRole('button', { name: 'Allow camera' }));
  await settle();

  // Microphone selection, Wind filter & Quality preset before going live
  chooseOption(screen.getByRole('combobox', { name: 'Microphone' }), 'rodelink');
  await settle();
  expect(publisher.switchAudio).toHaveBeenCalledWith('rodelink');

  fireEvent.click(screen.getByRole('button', { name: /Cut wind noise/i }));
  expect(publisher.setWindFilter).toHaveBeenCalledWith(true);

  fireEvent.click(screen.getByRole('button', { name: '720p' }));
  expect(publisher.setQualityPreset).toHaveBeenCalledWith('720p');

  // Start stream (occupied because Main Arena · Main camera is in state.streams)
  fireEvent.click(screen.getByRole('button', { name: 'Take over and go live' }));
  await settle();

  // Camera zoom pills
  fireEvent.click(screen.getByRole('button', { name: 'Camera zoom 2x' }));
  expect(publisher.setZoom).toHaveBeenCalledWith(2);

  // Director multi-camera cut
  fireEvent.click(screen.getByRole('button', { name: 'Cut to Finish line' }));
  await settle();
  expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/2/command', {
    command: 'selectAngle',
    value: '2',
  });

  expect(screen.queryByRole('button', { name: '+1h' })).toBeNull();

  // Tripod Lock & Dim screen saver
  fireEvent.click(screen.getByRole('button', { name: 'Lock and dim screen' }));
  expect(screen.getByRole('dialog', { name: 'Screen dimmed for tripod battery saving' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Screen locked' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Tap to unlock.' }));
  expect(screen.queryByRole('dialog', { name: 'Screen dimmed for tripod battery saving' })).toBeNull();

  state.lastStreamCommand = { streamId: 99, arenaName: 'Main Arena', command: 'flipCamera', issuedAt: '2026-10-24T12:04:00Z' };
  const flips = publisher.switchCamera.mock.calls.length;
  rerender(<MemoryRouter initialEntries={['/competitions/1/broadcast']}><BroadcastPage /></MemoryRouter>);
  expect(publisher.switchCamera).toHaveBeenCalledTimes(flips);

  // Remote commands from ScorerPage
  state.lastStreamCommand = { streamId: 1, arenaName: 'Main Arena', command: 'setZoom', value: '3', issuedAt: '2026-10-24T12:05:00Z' };
  rerender(<MemoryRouter initialEntries={['/competitions/1/broadcast']}><BroadcastPage /></MemoryRouter>);
  expect(publisher.setZoom).toHaveBeenLastCalledWith(3);
  // The on-screen controls follow the remote command rather than drifting.
  expect(screen.getByRole('button', { name: 'Camera zoom 3x' })).toHaveAttribute('aria-pressed', 'true');

  state.lastStreamCommand = { streamId: 1, arenaName: 'Main Arena', command: 'setQualityPreset', value: '360p', issuedAt: '2026-10-24T12:06:00Z' };
  rerender(<MemoryRouter initialEntries={['/competitions/1/broadcast']}><BroadcastPage /></MemoryRouter>);
  expect(publisher.setQualityPreset).toHaveBeenLastCalledWith('360p');

  // On-air quality pills, quick mic mute button, and one-tap reconnect when signal drops
  fireEvent.click(screen.getByRole('button', { name: '480p Saver' }));
  expect(publisher.setQualityPreset).toHaveBeenLastCalledWith('480p');
  fireEvent.click(screen.getByRole('button', { name: 'Auto HD' }));
  expect(publisher.setQualityPreset).toHaveBeenLastCalledWith('auto');

  fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
  await settle();
  expect(publisher.mute).toHaveBeenLastCalledWith(true);

  act(() => update({ signal: 'poor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect stream' }));
  expect(publisher.reconnect).toHaveBeenCalledTimes(1);

  // The on-air replay status reports retained media, not elapsed broadcast time
  expect(screen.getByText(/Replay history:/)).toBeVisible();

  // Bottom bar ("Viewers see") hides automatically when Overlays modal is opened
  expect(screen.getByText('Viewers see')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Overlays' }));
  expect(screen.queryByText('Viewers see')).toBeNull();

  // Open Saved replays (last 30 minutes) from Overlays modal
  fireEvent.click(screen.getByRole('button', { name: 'Saved replays (last 30 minutes)' }));
  expect(screen.getByRole('dialog', { name: 'Saved replays' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close saved replays' }));
});

it('pre-fills arena and camera angle from query parameters when pairing a 2nd camera phone', async () => {
  render(
    <MemoryRouter initialEntries={['/competitions/1/broadcast?arena=Second+Arena&angle=Finish+line']}>
      <BroadcastPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Allow camera' }));
  await settle();
  expect(screen.getByRole('button', { name: 'Second Arena' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Finish line' })).toHaveAttribute('aria-pressed', 'true');
});
