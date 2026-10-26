import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { competition, session } from '../../test/factories';
import type { LiveStream, StreamCommand, StreamTelemetry } from '../../types';
import { CompetitionContext } from './context';
import { StreamControlsPage } from './StreamControlsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const auth = vi.hoisted(() => ({ organise: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => auth.organise }) }));
vi.mock('../../components/stream/LiveVideo', () => ({ LiveVideo: () => <div data-testid="live-video" /> }));

const stream = (id: number, extra: Partial<LiveStream> = {}): LiveStream => ({
  id, competitionId: 1, arenaName: 'Main Arena', angleName: id === 1 ? 'Main camera' : 'Finish line', status: 0, caption: null,
  audioMuted: false, hasAudio: true, startedAt: '2026-06-01T10:00:00Z', viewerCount: 5, generation: 1, ...extra,
});

function mount(opts: { streams?: LiveStream[]; url?: string; telemetry?: Record<number, StreamTelemetry>; command?: StreamCommand | null } = {}) {
  const value = {
    competition: competition({ sessions: [session(1, { arenaName: 'Main Arena' })] }), reload: vi.fn(), streams: opts.streams ?? [],
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

beforeEach(() => {
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
