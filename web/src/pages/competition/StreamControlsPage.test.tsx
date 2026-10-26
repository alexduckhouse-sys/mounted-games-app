import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { competition, heat, race, session } from '../../test/factories';
import { DEFAULT_OVERLAY } from '../../lib/overlays';
import { readCard, readLiveOptions } from '../../lib/streamOverlayTiles';
import type { LiveStream, StreamCommand, StreamOverlay, StreamTelemetry } from '../../types';
import { CompetitionContext } from './context';
import { StreamControlsPage } from './StreamControlsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const saveOverlay = vi.fn();
const auth = vi.hoisted(() => ({ organise: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => auth.organise }) }));
vi.mock('../../components/stream/LiveVideo', () => ({ LiveVideo: () => <div data-testid="live-video" /> }));

const stream = (id: number, extra: Partial<LiveStream> = {}): LiveStream => ({
  id, competitionId: 1, arenaName: 'Main Arena', angleName: id === 1 ? 'Main camera' : 'Finish line', status: 0, caption: null,
  audioMuted: false, hasAudio: true, startedAt: '2026-06-01T10:00:00Z', viewerCount: 5, generation: 1, ...extra,
});

function mount(opts: { streams?: LiveStream[]; url?: string; telemetry?: Record<number, StreamTelemetry>; command?: StreamCommand | null; overlay?: StreamOverlay; readOnly?: boolean } = {}) {
  const value = {
    competition: competition({
      sections: [{ id: 5, competitionId: 1, format: 2, ageGroup: 'U12', displayName: 'Under 12', finalistCount: 2 }, { id: 6, competitionId: 1, format: 2, ageGroup: 'U15', displayName: 'Under 15', finalistCount: 2 }],
      sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { label: 'Heat 1', races: [race(1, { name: 'Bending', isComplete: true }), race(2, { name: 'Mug' })] })] })],
    }), reload: vi.fn(), streams: opts.streams ?? [], overlay: opts.overlay ?? DEFAULT_OVERLAY, saveOverlay: opts.readOnly ? undefined : saveOverlay,
    streamTelemetry: opts.telemetry, lastStreamCommand: opts.command ?? null, streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [],
  };
  return render(
    <MemoryRouter initialEntries={[opts.url ?? '/competitions/1/stream-controls']}>
      <CompetitionContext.Provider value={value}>
        <Routes><Route path="/competitions/:id/stream-controls" element={<StreamControlsPage />} /></Routes>
      </CompetitionContext.Provider>
    </MemoryRouter>,
  );
}

let stored: StreamOverlay = DEFAULT_OVERLAY;
beforeEach(() => {
  localStorage.clear();
  stored = DEFAULT_OVERLAY;
  saveOverlay.mockReset().mockImplementation(async (change: (o: StreamOverlay) => StreamOverlay) => { stored = change(stored); return 'saved'; });
  auth.organise = true;
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t end the stream');
  });
});

describe('Camera tab', () => {
  const live = [stream(1), stream(2)];

  it('says when no camera is live and offers the grey add bar with a QR code', async () => {
    const user = userEvent.setup();
    mount({ url: '/competitions/1/stream-controls?tab=camera' });
    expect(screen.getByText(/No camera is live/)).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add a camera phone' });
    expect(add).toHaveClass('sx-addbar');
    await user.click(add);
    const panel = screen.getByRole('region', { name: 'Add a camera phone' });
    expect(within(panel).getByRole('img', { name: 'QR code to add a camera phone' })).toBeInTheDocument();
    expect(within(panel).getByText(/broadcast\?arena=Main%20Arena&angle=Finish%20line/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('radio', { name: 'Main stand' }));
    expect(within(panel).getByText(/angle=Main%20stand/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'It’s connected' }));
    expect(screen.queryByRole('region', { name: 'Add a camera phone' })).toBeNull();
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

describe('Overlay tab', () => {
  it('lays the overlays out as two-column tiles with None, Automatic and Back soon first', () => {
    mount();
    const group = screen.getByRole('radiogroup', { name: 'On screen' });
    const tiles = within(group).getAllByRole('radio');
    expect(tiles.map((tile) => tile.textContent)).toEqual(['None', 'Automatic', 'Back soon', 'Toplist', 'Heat table', 'Podium', 'Race result', 'Up next', 'Race title', 'Sponsors']);
    expect(tiles[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('button', { name: 'Show' })).toHaveLength(1); // the banner button; tiles have no Show buttons
    expect(screen.getAllByRole('button', { name: /settings$/ })).toHaveLength(6);
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
    expect(screen.getAllByRole('switch').map((el) => el.getAttribute('aria-label'))).toEqual(['Run automations', 'After each race', 'From Session 2', 'After a session', 'Before each race', 'Between races']);
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
});
