import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { competition, heat, race, session } from '../../test/factories';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { LiteModeProvider } from '../../lite/LiteModeContext';
import { LITE_STORAGE_KEY } from '../../lite/liteMode';
import { asMedia, FakeMediaStream, FakePeer, fakePeerConstructor, fakeStreamConstructor, flush, resetMedia } from '../../test/streamFakes';
import { readCard, readLiveOptions } from '../../lib/streamOverlayTiles';
import type { LiveStream, StreamCommand, StreamOverlay, StreamTelemetry } from '../../types';
import type { StreamInvoke } from '../../live/streamRuntime';
import { CompetitionContext } from './context';
import { StreamControlsPage } from './StreamControlsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const saveOverlay = vi.fn();
const auth = vi.hoisted(() => ({ organise: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => auth.organise }) }));
const monitor = vi.hoisted(() => ({ id: null as number | null, media: null as MediaStream | null }));
vi.mock('../../components/stream/LiveVideo', () => ({
  LiveVideo: ({ onMedia }: { onMedia?: (media: MediaStream | null, streamId?: number) => void }) => {
    useEffect(() => {
      if (monitor.id !== null) onMedia?.(monitor.media, monitor.id);
      return () => onMedia?.(null);
    }, [onMedia]);
    return <div data-testid="live-video" />;
  },
}));

const stream = (id: number, extra: Partial<LiveStream> = {}): LiveStream => ({
  id, competitionId: 1, arenaName: 'Main Arena', angleName: id === 1 ? 'Main camera' : 'Finish line', status: 0, caption: null,
  audioMuted: false, hasAudio: true, startedAt: '2026-06-01T10:00:00Z', viewerCount: 5, generation: 1, ...extra,
});

type MountOptions = { streams?: LiveStream[]; url?: string; telemetry?: Record<number, StreamTelemetry>; command?: StreamCommand | null; overlay?: StreamOverlay; readOnly?: boolean; arenas?: string[]; invoke?: ReturnType<typeof vi.fn> };
function page(opts: MountOptions = {}) {
  const value = {
    competition: competition({
      sections: [{ id: 5, competitionId: 1, format: 2, ageGroup: 'U12', displayName: 'Under 12', finalistCount: 2 }, { id: 6, competitionId: 1, format: 2, ageGroup: 'U15', displayName: 'Under 15', finalistCount: 2 }],
      sessions: (opts.arenas ?? ['Main Arena']).map((arenaName, index) => session(index + 1, { arenaName, heats: index === 0 ? [heat(1, { label: 'Heat 1', races: [race(1, { name: 'Bending', isComplete: true }), race(2, { name: 'Mug' })] })] : [] })),
    }), reload: vi.fn(), streams: opts.streams ?? [], overlay: opts.overlay ?? DEFAULT_OVERLAY, saveOverlay: opts.readOnly ? undefined : saveOverlay,
    streamTelemetry: opts.telemetry, lastStreamCommand: opts.command ?? null, streamingEnabled: true, invoke: (opts.invoke ?? vi.fn()) as unknown as StreamInvoke, ready: 1, streamMessages: [],
  };
  return (
    <LiteModeProvider>
      <MemoryRouter initialEntries={[opts.url ?? '/competitions/1/stream-controls']}>
        <CompetitionContext.Provider value={value}>
          <Routes><Route path="/competitions/:id/stream-controls" element={<StreamControlsPage />} /></Routes>
        </CompetitionContext.Provider>
      </MemoryRouter>
    </LiteModeProvider>
  );
}
function mount(opts: MountOptions = {}) {
  const view = render(page(opts));
  return { ...view, update: (next: MountOptions) => view.rerender(page({ ...opts, ...next })) };
}

let stored: StreamOverlay = DEFAULT_OVERLAY;
beforeEach(() => {
  localStorage.clear();
  stored = DEFAULT_OVERLAY;
  saveOverlay.mockReset().mockImplementation(async (change: (o: StreamOverlay) => StreamOverlay) => { stored = change(stored); return 'saved'; });
  auth.organise = true;
  monitor.id = null; monitor.media = null;
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
});

describe('StreamControlsPage', () => {
  it('tells people who cannot organise that it is for the organiser', () => {
    auth.organise = false;
    mount();
    expect(screen.getByText(/Only the competition organiser or team/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows four tabs as one row, a Not live box and no End stream when nothing is streaming', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Stream controls' })).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist', { name: 'Stream controls' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overlay', 'Auto', 'Replay', 'Camera']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Not live');
    expect(screen.queryByRole('button', { name: 'End stream' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to live stream' })).toHaveAttribute('href', '/competitions/1/chat');
  });

  it('keeps the chosen tab in the address and honours ?tab=', async () => {
    const user = userEvent.setup();
    mount({ url: '/competitions/1/stream-controls?tab=camera' });
    expect(screen.getByRole('tab', { name: 'Camera' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Auto' }));
    expect(screen.getByRole('tab', { name: 'Auto' })).toHaveAttribute('aria-selected', 'true');
  });

  it('on a phone shows Cameras, Graphics and Replays, with Auto inside Graphics', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767px)', media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    try {
      const user = userEvent.setup();
      mount({ url: '/competitions/1/stream-controls?tab=auto' });
      const tabs = within(screen.getByRole('tablist', { name: 'Stream controls' })).getAllByRole('tab');
      expect(tabs.map((tab) => tab.textContent)).toEqual(['Cameras', 'Graphics', 'Replays']);
      expect(screen.getByRole('tab', { name: 'Graphics' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Graphics' })).toHaveTextContent('Run automations');
      await user.click(screen.getByRole('tab', { name: 'Replays' }));
      expect(screen.getByRole('tab', { name: 'Replays' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: 'Replays' })).not.toHaveTextContent('Run automations');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('puts End stream in the header, asks first, then ends every live camera', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    mount({ streams: [stream(1), stream(2), stream(3, { status: 2 })] });
    expect(screen.getByTestId('live-video')).toBeInTheDocument();
    const end = screen.getByRole('button', { name: 'End stream' });
    expect(end).toHaveClass('sx-end');
    expect(end.closest('header')).not.toBeNull();
    await user.click(end);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(asked.titles).toEqual(['End the stream?']);
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/1/end');
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/2/end');
  });

  it('does nothing when End stream is cancelled, and says when it failed', async () => {
    const user = userEvent.setup();
    autoConfirm([false, true]);
    mount({ streams: [stream(1)] });
    await user.click(screen.getByRole('button', { name: 'End stream' }));
    expect(api.post).not.toHaveBeenCalled();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'End stream' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t end the stream. Check your signal and try again.');
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Camera tab', () => {
  const live = [stream(1), stream(2)];

  const cameraUrl = '/competitions/1/stream-controls?tab=camera';
  const created = (token = 'mgs_cam_token') => ({ data: { link: { id: 7, label: 'Main Arena · Finish line', arenaName: 'Main Arena', scope: 1 }, token, path: `/score#t=${token}` } });

  it('says when no camera is live and makes a real camera link only when asked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce(created());
    mount({ url: cameraUrl });
    expect(screen.getByText(/No camera is live/)).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add a camera phone' });
    expect(add).toHaveClass('sx-addbar');
    await user.click(add);
    expect(add).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'Add a camera phone' });
    expect(within(panel).queryByRole('img')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    // One arena: no arena row, just the position.
    expect(within(panel).queryByRole('button', { name: /^Arena:/ })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Position: Finish line' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Make QR code' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/scorer-links', { label: 'Main Arena · Finish line', arenaName: 'Main Arena', scope: 1 });
    expect(await within(panel).findByRole('img', { name: 'QR code for the Finish line camera' })).toBeInTheDocument();
    expect(within(panel).getByText(`${window.location.origin}/score#t=mgs_cam_token&angle=Finish%20line`)).toBeInTheDocument();
    expect(within(panel).getByText(/No account needed/)).toBeInTheDocument();
  });

  it('reuses the link for the same arena and position, and makes a new one for another position', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce(created('mgs_first')).mockResolvedValueOnce(created('mgs_second'));
    mount({ url: cameraUrl });
    await user.click(screen.getByRole('button', { name: 'Add a camera phone' }));
    const panel = screen.getByRole('region', { name: 'Add a camera phone' });
    await user.click(within(panel).getByRole('button', { name: 'Make QR code' }));
    await within(panel).findByText(/mgs_first/);
    await user.click(within(panel).getByRole('button', { name: 'Position: Finish line' }));
    await user.click(screen.getByRole('option', { name: 'Main stand' }));
    expect(within(panel).queryByRole('img')).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Make QR code' }));
    expect(await within(panel).findByText(/mgs_second&angle=Main%20stand/)).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith('/competitions/1/scorer-links', { label: 'Main Arena · Main stand', arenaName: 'Main Arena', scope: 1 });
    await user.click(within(panel).getByRole('button', { name: 'Position: Main stand' }));
    await user.click(screen.getByRole('option', { name: 'Finish line' }));
    expect(within(panel).getByText(/mgs_first&angle=Finish%20line/)).toBeInTheDocument();
    // Closing and opening again keeps the links made on this tab.
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Add a camera phone' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add a camera phone' }));
    expect(screen.getByText(/mgs_first/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('lets the producer name their own position and pick the arena', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce(created('mgs_own'));
    mount({ url: cameraUrl, arenas: ['Main Arena', 'Ring 2'] });
    await user.click(screen.getByRole('button', { name: 'Add a camera phone' }));
    const panel = screen.getByRole('region', { name: 'Add a camera phone' });
    await user.click(within(panel).getByRole('button', { name: 'Arena: Main Arena' }));
    await user.click(screen.getByRole('option', { name: 'Ring 2' }));
    await user.click(within(panel).getByRole('button', { name: 'Position: Finish line' }));
    await user.click(screen.getByRole('option', { name: 'Other…' }));
    await user.type(screen.getByRole('textbox', { name: 'Position, your own' }), 'Judges box{Enter}');
    await user.click(within(panel).getByRole('button', { name: 'Make QR code' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/scorer-links', { label: 'Ring 2 · Judges box', arenaName: 'Ring 2', scope: 1 });
    expect(await within(panel).findByText(/mgs_own&angle=Judges%20box/)).toBeInTheDocument();
  });

  it('shows a plain error and Try again instead of a QR code when the link fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce(created());
    mount({ url: cameraUrl });
    await user.click(screen.getByRole('button', { name: 'Add a camera phone' }));
    const panel = screen.getByRole('region', { name: 'Add a camera phone' });
    await user.click(within(panel).getByRole('button', { name: 'Make QR code' }));
    const strip = await within(panel).findByRole('alert');
    expect(strip).toHaveTextContent('Couldn’t make the camera link. Check your signal and try again.');
    expect(within(panel).queryByRole('img')).toBeNull();
    // A reply without a token is a failure too, never a made-up code.
    await user.click(within(strip).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(within(panel).queryByRole('img')).toBeNull();
    await user.click(within(within(panel).getByRole('alert')).getByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByRole('img', { name: 'QR code for the Finish line camera' })).toBeInTheDocument();
    expect(within(panel).queryByRole('alert')).toBeNull();
  });

  it('passes on the reason the API gives, such as a finished competition', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 400, data: { message: 'This competition has finished, so it can\'t have new scorer links.' } } });
    mount({ url: cameraUrl });
    await user.click(screen.getByRole('button', { name: 'Add a camera phone' }));
    await user.click(screen.getByRole('button', { name: 'Make QR code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This competition has finished');
  });

  it('copies the link, and says so when copying is refused', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce(created());
    mount({ url: cameraUrl });
    await user.click(screen.getByRole('button', { name: 'Add a camera phone' }));
    await user.click(screen.getByRole('button', { name: 'Make QR code' }));
    await screen.findByRole('img', { name: 'QR code for the Finish line camera' });
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/score#t=mgs_cam_token&angle=Finish%20line`);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t copy the link');
  });

  it('closes the panel and confirms once the new camera goes live', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValueOnce(created());
    const existing = stream(2, { angleName: 'Finish line' });
    const view = mount({ url: cameraUrl, streams: [stream(1), existing] });
    await user.click(screen.getByRole('button', { name: 'Add a camera phone' }));
    await user.click(screen.getByRole('button', { name: 'Make QR code' }));
    await screen.findByRole('img', { name: 'QR code for the Finish line camera' });
    expect(screen.getByText('Waiting for the camera to go live…')).toBeInTheDocument();
    // A different position joining doesn't count.
    view.update({ streams: [stream(1), existing, stream(8, { angleName: 'Main stand' })] });
    expect(screen.getByRole('region', { name: 'Add a camera phone' })).toBeInTheDocument();
    view.update({ streams: [stream(1), stream(9, { angleName: 'Finish line' })] });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Add a camera phone' })).toBeNull());
    expect(await screen.findByText('Finish line camera connected')).toBeInTheDocument();
  });

  it('lists cameras with ON AIR and cuts to another one', async () => {
    const user = userEvent.setup();
    mount({ streams: live, url: '/competitions/1/stream-controls?tab=camera' });
    const group = screen.getByRole('radiogroup', { name: 'Camera' });
    const [first, second] = within(group).getAllByRole('radio');
    expect(first).toHaveAttribute('aria-checked', 'true');
    expect(within(first).getByText('ON AIR')).toBeInTheDocument();
    await user.click(second);
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/2/command', { command: 'selectAngle', value: '2' });
    await waitFor(() => expect(second).toHaveAttribute('aria-checked', 'true'));
  });

  it('keeps the old camera on air if the cut fails', async () => {
    const user = userEvent.setup();
    mount({ streams: live, url: '/competitions/1/stream-controls?tab=camera' });
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await user.click(within(screen.getByRole('radiogroup', { name: 'Camera' })).getAllByRole('radio')[1]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t reach the camera phone');
    expect(within(screen.getByRole('radiogroup', { name: 'Camera' })).getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('sends quality, wind filter, sound and flip to the camera on air', async () => {
    const user = userEvent.setup();
    mount({ streams: [stream(1)], url: '/competitions/1/stream-controls?tab=camera', telemetry: { 1: { streamId: 1, arenaName: 'Main Arena', qualityPreset: '720p', windFilter: false, audioMuted: false, updatedAt: '' } } });
    const quality = screen.getByRole('radiogroup', { name: 'Quality' });
    expect(within(quality).getByRole('radio', { name: '720p' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(quality).getByRole('radio', { name: 'Auto HD' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/1/command', { command: 'setQualityPreset', value: 'auto' });
    await waitFor(() => expect(within(quality).getByRole('radio', { name: 'Auto HD' })).toHaveAttribute('aria-checked', 'true'));
    await user.click(screen.getByRole('switch', { name: 'Wind filter' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/1/command', { command: 'windFilter', value: 'true' });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Wind filter' })).toHaveAttribute('aria-checked', 'true'));
    await user.click(screen.getByRole('switch', { name: 'Sound' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/1/command', { command: 'mute', value: 'true' });
    await user.click(screen.getByRole('button', { name: 'Flip' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/1/command', { command: 'flipCamera', value: null });
  });
});

describe('Camera previews', () => {
  const cameraUrl = '/competitions/1/stream-controls?tab=camera';
  const hub = () => vi.fn(async (method: string) => method.startsWith('WatchStream') ? { watchId: 'w', sdpOffer: 'offer', generation: 1, iceServers: [] } : undefined);
  const watched = (invoke: ReturnType<typeof vi.fn>) => invoke.mock.calls.filter(([method]) => method === 'WatchStreamTier').map(([, , id, rid]) => `${id}:${rid}`);
  const setVisibility = (state: DocumentVisibilityState) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  };
  beforeEach(() => {
    resetMedia();
    vi.stubGlobal('RTCPeerConnection', fakePeerConstructor);
    vi.stubGlobal('MediaStream', fakeStreamConstructor);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('shows the big player’s picture for the camera on air and the smallest layer for the others in its arena', async () => {
    const invoke = hub();
    monitor.id = 1; monitor.media = asMedia(new FakeMediaStream());
    mount({ url: cameraUrl, invoke, streams: [stream(1), stream(2), stream(3, { arenaName: 'Ring 2', angleName: 'Wide' })] });
    await act(flush);
    expect(watched(invoke)).toEqual(['2:q']);
    expect(invoke).not.toHaveBeenCalledWith('WatchStream', expect.anything(), expect.anything());
    expect(screen.getByLabelText('Main camera preview')).toBeInTheDocument();
    expect(screen.getByLabelText('Finish line preview')).toBeInTheDocument();
    expect(screen.queryByLabelText('Wide preview')).toBeNull();
    expect(FakePeer.instances).toHaveLength(1);
    act(() => FakePeer.instances[0].track());
    await waitFor(() => expect(screen.getByLabelText('Finish line preview').parentElement).toHaveAttribute('data-ready', 'true'));
  });

  it('previews at most four cameras', async () => {
    const invoke = hub();
    mount({ url: cameraUrl, invoke, streams: [1, 2, 3, 4, 5, 6].map((id) => stream(id, { angleName: `Cam ${id}` })) });
    await act(flush);
    expect(watched(invoke)).toEqual(['1:q', '2:q', '3:q', '4:q']);
    expect(screen.queryByLabelText('Cam 5 preview')).toBeNull();
  });

  it('stops the previews while the app is in the background and when leaving the tab', async () => {
    const user = userEvent.setup();
    const invoke = hub();
    mount({ url: cameraUrl, invoke, streams: [stream(1), stream(2)] });
    await act(flush);
    expect(watched(invoke)).toEqual(['1:q', '2:q']);
    setVisibility('hidden');
    await act(flush);
    expect(screen.queryByLabelText('Finish line preview')).toBeNull();
    expect(invoke).toHaveBeenCalledWith('StopWatching', 2);
    setVisibility('visible');
    await act(flush);
    expect(watched(invoke)).toEqual(['1:q', '2:q', '1:q', '2:q']);
    invoke.mockClear();
    await user.click(screen.getByRole('tab', { name: 'Auto' }));
    await act(flush);
    expect(invoke).toHaveBeenCalledWith('StopWatching', 1);
    expect(invoke).toHaveBeenCalledWith('StopWatching', 2);
  });

  it('shows no previews in Lite mode', async () => {
    localStorage.setItem(LITE_STORAGE_KEY, 'on');
    const invoke = hub();
    mount({ url: cameraUrl, invoke, streams: [stream(1), stream(2)] });
    await act(flush);
    expect(watched(invoke)).toEqual([]);
    expect(screen.queryByLabelText('Main camera preview')).toBeNull();
    expect(within(screen.getByRole('radiogroup', { name: 'Camera' })).getAllByRole('radio')).toHaveLength(2);
  });
});

describe('Overlay tab', () => {
  it('offers Show me when the overlay changed on another phone, and Try again for a failed save', async () => {
    const user = userEvent.setup();
    mount();
    saveOverlay.mockResolvedValueOnce('conflict');
    await user.click(screen.getByRole('radio', { name: 'Heat table' }));
    const strip = await screen.findByRole('alert');
    expect(strip).toHaveTextContent('The overlay changed on another phone. Check it and try again.');
    await user.click(within(strip).getByRole('button', { name: 'Show me' }));
    expect(screen.getByRole('radio', { name: 'None' })).toHaveFocus();
    saveOverlay.mockResolvedValueOnce('failed');
    await user.click(screen.getByRole('radio', { name: 'Heat table' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change the overlay. Check your signal and try again.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(saveOverlay).toHaveBeenCalledTimes(3);
  });

  it('lays the overlays out as two-column tiles with None, Automatic and Back soon first', () => {
    mount();
    const group = screen.getByRole('radiogroup', { name: 'On screen' });
    const tiles = within(group).getAllByRole('radio');
    expect(tiles.map((tile) => tile.textContent)).toEqual(['None', 'Automatic', 'Back soon', 'Toplist', 'Heat table', 'Podium', 'Race result', 'Up next', 'Favourites', 'Race title', 'Sponsors']);
    expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('button', { name: 'Show' })).toHaveLength(1); // the banner button; tiles have no Show buttons
    expect(screen.getAllByRole('button', { name: /settings$/ })).toHaveLength(7);
  });

  it('puts a tile on screen with one tap and shows it as on', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('radio', { name: 'Heat table' }));
    expect(readCard(stored)).toBe('heat');
    await user.click(screen.getByRole('radio', { name: 'Automatic' }));
    expect(readCard(stored)).toBe('auto');
    expect(screen.getByRole('button', { name: 'Auto on' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the chosen tile as on and says when viewers do not draw it yet', () => {
    mount({ overlay: { ...DEFAULT_OVERLAY, look: { liveCard: 'podium' } } });
    expect(screen.getByRole('radio', { name: 'Podium' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Viewers don’t see podium yet.')).toBeInTheDocument();
  });

  it('opens one overlay’s settings from its chevron and saves a choice', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Toplist settings' }));
    const panel = screen.getByRole('group', { name: 'Toplist settings' });
    await user.click(within(panel).getByRole('radio', { name: 'Top 3' }));
    expect(readLiveOptions(stored).toplistRows).toBe(3);
    await user.click(screen.getByRole('button', { name: 'Heat table settings' }));
    expect(screen.queryByRole('group', { name: 'Toplist settings' })).toBeNull();
    await user.click(within(screen.getByRole('group', { name: 'Heat table settings' })).getByRole('radio', { name: 'Totals only' }));
    expect(readLiveOptions(stored).heatShow).toBe('total');
    await user.click(screen.getByRole('button', { name: 'Up next settings' }));
    await user.click(screen.getByRole('radio', { name: 'Next 3' }));
    expect(readLiveOptions(stored).nextCount).toBe(3);
    await user.click(screen.getByRole('button', { name: 'Up next settings' }));
    expect(screen.queryByRole('group', { name: 'Up next settings' })).toBeNull();
  });

  it('chooses how many favourites to list', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Favourites settings' }));
    expect(readLiveOptions(stored).favouritesRows).toBe(5);
    await user.click(within(screen.getByRole('group', { name: 'Favourites settings' })).getByRole('radio', { name: 'Top 3' }));
    expect(readLiveOptions(stored).favouritesRows).toBe(3);
  });

  it('chooses the podium age group and steps the reveal one place at a time', async () => {
    const user = userEvent.setup();
    mount({ overlay: { ...DEFAULT_OVERLAY, look: { liveCard: 'podium', liveOptions: { podiumReveal: 'one', podiumShown: 1 } } } });
    await user.click(screen.getByRole('button', { name: 'Podium settings' }));
    const panel = screen.getByRole('group', { name: 'Podium settings' });
    await user.click(within(panel).getByRole('radio', { name: 'Under 15' }));
    expect(readLiveOptions(stored).podiumSectionId).toBe(6);
    expect(within(panel).getByText('Next: 2nd')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Reveal next' }));
    expect(readLiveOptions(stored).podiumShown).toBe(2);
    await user.click(within(panel).getByRole('radio', { name: 'All at once' }));
    expect(readLiveOptions(stored).podiumReveal).toBe('all');
  });

  it('lists finished races for Race result and says when none has finished', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Race result settings' }));
    const panel = screen.getByRole('group', { name: 'Race result settings' });
    await user.click(within(panel).getByRole('radio', { name: 'Heat 1 · Bending' }));
    expect(readLiveOptions(stored).resultRaceId).toBe(1);
  });

  it('sets the sponsor size and moves to the next sponsor', async () => {
    const user = userEvent.setup();
    mount({ overlay: { ...DEFAULT_OVERLAY, look: { liveCard: 'sponsor' } } });
    await user.click(screen.getByRole('button', { name: 'Sponsors settings' }));
    const panel = screen.getByRole('group', { name: 'Sponsors settings' });
    await user.click(within(panel).getByRole('radio', { name: 'Corner' }));
    expect(readLiveOptions(stored).sponsorSize).toBe('corner');
    await user.click(within(panel).getByRole('button', { name: 'Next sponsor' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/sponsors/skip');
  });

  it('has no Show buttons or hints under the tiles', () => {
    mount();
    expect(screen.queryByText('Middle of the screen')).toBeNull();
    expect(screen.queryByText('Just the lanes bar')).toBeNull();
  });

  it('puts a banner up and takes it down', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('Message across the top'), 'Lunch until 2pm');
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(stored).toMatchObject({ bannerText: 'Lunch until 2pm' });
  });

  it('shows a banner already up and takes it down', async () => {
    const user = userEvent.setup();
    mount({ overlay: { ...DEFAULT_OVERLAY, bannerText: 'Lunch until 2pm' } });
    expect(screen.getByLabelText('Message across the top')).toHaveValue('Lunch until 2pm');
    await user.click(screen.getByRole('button', { name: 'Take down' }));
    expect(stored.bannerText).toBeNull();
  });

  it('says so when the overlay cannot be changed from this device, and when a save fails', async () => {
    const user = userEvent.setup();
    mount({ readOnly: true });
    expect(screen.getByText(/can’t change the overlay from this device/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Heat table' })).toBeDisabled();
    cleanup();
    saveOverlay.mockResolvedValueOnce('failed');
    mount();
    await user.click(screen.getByRole('radio', { name: 'Heat table' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change the overlay');
  });

  it('sends Back soon to the camera on air', async () => {
    const user = userEvent.setup();
    mount({ streams: [stream(1)] });
    await user.click(screen.getByRole('radio', { name: 'Back soon' }));
    expect(api.post).toHaveBeenCalledWith('/competitions/1/streams/1/command', { command: 'pause', value: 'true' });
  });
});

describe('Auto tab', () => {
  const openAuto = () => mount({ url: '/competitions/1/stream-controls?tab=auto' });

  it('is off to begin with and says it runs while the page is open', () => {
    openAuto();
    expect(screen.getByRole('switch', { name: 'Run automations' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off. Nothing changes on its own.')).toBeInTheDocument();
    expect(screen.getByText(/Runs while a stream controls page is open/)).toBeInTheDocument();
  });

  it('turns automations on and names the next race', async () => {
    const user = userEvent.setup();
    openAuto();
    await user.click(screen.getByRole('switch', { name: 'Run automations' }));
    expect(screen.getByText('Next: heat table after Mug')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('mg.streamAuto.1')!).on).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Auto on' }));
    expect(screen.getByText('Off. Nothing changes on its own.')).toBeInTheDocument();
  });

  it('lists the rules, with choices only for rules that are on', async () => {
    const user = userEvent.setup();
    openAuto();
    expect(screen.getAllByRole('switch').map((el) => el.getAttribute('aria-label'))).toEqual(['Run automations', 'After each race', 'From Session 2', 'After a session', 'Before each race', 'Between races', 'Before a final', 'Prize-giving after each final']);
    expect(screen.getByRole('radiogroup', { name: 'Show for' })).toBeInTheDocument();
    expect(screen.queryByText('Sponsors for 10s')).not.toBeNull();
    await user.click(within(screen.getByRole('radiogroup', { name: 'Show for' })).getByRole('radio', { name: '30s' }));
    expect(screen.getByText('Heat table for 30s')).toBeInTheDocument();
    await user.click(within(screen.getByRole('radiogroup', { name: 'How often' })).getByRole('radio', { name: 'Every race' }));
    expect(screen.getByText('Toplist after every race, for 20s')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'After each race' }));
    expect(screen.queryByRole('radiogroup', { name: 'Show for' })).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Between races' }));
    expect(screen.getAllByRole('radiogroup', { name: 'Show for' })).toHaveLength(1);
  });

  it('keeps the prize-giving after each final on by default and lets it be switched off for everyone', async () => {
    const user = userEvent.setup();
    openAuto();
    const toggle = screen.getByRole('switch', { name: 'Prize-giving after each final' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(readLiveOptions(stored).autoPrizeGiving).toBe(false);
  });

  it('turns the favourites rule on before a final', async () => {
    const user = userEvent.setup();
    openAuto();
    expect(screen.getByText('Favourites for 15s')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Before a final' }));
    expect(JSON.parse(localStorage.getItem('mg.streamAuto.1')!).rules.favourites.on).toBe(true);
  });
});

vi.mock('./streamControls/SavedOverlayLooks', () => ({ SavedOverlayLooks: () => null }));
