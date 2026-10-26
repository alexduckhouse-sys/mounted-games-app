import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, session } from '../../test/factories';
import * as buffer from '../../live/replayBuffer';
import type { SavedReplayClip } from '../../live/replayBuffer';
import type { QueuedScoreCard } from '../../lib/scoreCard';
import type { LiveStream } from '../../types';
import { CompetitionContext } from './context';
import { StreamControlsPage } from './StreamControlsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => true }) }));
vi.mock('../../live/replayBuffer');
const render45 = vi.hoisted(() => vi.fn());
vi.mock('../../components/stream/ReplayInspector', () => ({ renderTrimmedFollowClip: render45 }));
const fakeMedia = {} as MediaStream;
vi.mock('../../components/stream/LiveVideo', () => ({
  LiveVideo: ({ onMedia }: { onMedia?: (media: MediaStream | null) => void }) => {
    useEffect(() => { onMedia?.(fakeMedia); return () => onMedia?.(null); }, [onMedia]);
    return <div data-testid="live-video" />;
  },
}));

const camera: LiveStream = { id: 1, competitionId: 1, arenaName: 'Main Arena', angleName: 'Main', status: 0, caption: null, audioMuted: false, hasAudio: true, startedAt: '', viewerCount: 3, generation: 1 };
const clip = (id: string, extra: Partial<SavedReplayClip> = {}): SavedReplayClip => ({
  id, competitionId: 1, arenaName: 'Main Arena', label: id, createdAt: '2026-06-01T10:00:00Z', durationSeconds: 20, mimeType: 'video/webm',
  blob: new Blob(['x']), url: `blob:${id}`, trimStartSec: 0, trimEndSec: 20, ...extra,
});

let saved: SavedReplayClip[] = [];
let listeners: Array<() => void> = [];
let handle: { start: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; saveClip: ReturnType<typeof vi.fn> };
const notify = () => act(() => listeners.forEach((fn) => fn()));

function tree(url: string, streams: LiveStream[], scoreCards: QueuedScoreCard[]) {
  const value = {
    competition: competition({ sessions: [session(1, { arenaName: 'Main Arena' })] }), reload: vi.fn(), streams, streamingEnabled: true, invoke: vi.fn(), ready: 1, streamMessages: [], scoreCards,
  };
  return (
    <MemoryRouter initialEntries={[url]}>
      <CompetitionContext.Provider value={value}>
        <Routes><Route path="/competitions/:id/stream-controls" element={<StreamControlsPage />} /></Routes>
      </CompetitionContext.Provider>
    </MemoryRouter>
  );
}

function mount(url = '/competitions/1/stream-controls?tab=replay', streams: LiveStream[] = [camera]) {
  const view = render(tree(url, streams, []));
  return { ...view, scored: (cards: QueuedScoreCard[]) => view.rerender(tree(url, streams, cards)) };
}

beforeEach(() => {
  localStorage.clear();
  saved = [];
  listeners = [];
  handle = { start: vi.fn(() => true), dispose: vi.fn(), saveClip: vi.fn() };
  handle.saveClip.mockImplementation(async (label?: string) => { const made = clip('instant-1', { label: label ?? 'x' }); saved = [...saved, made]; notify(); return made; });
  vi.mocked(buffer.getSavedReplays).mockImplementation(() => saved);
  vi.mocked(buffer.subscribeSavedReplays).mockImplementation((fn) => { listeners.push(fn); return () => { listeners = listeners.filter((l) => l !== fn); }; });
  vi.mocked(buffer.hydrateSavedReplays).mockResolvedValue([]);
  vi.mocked(buffer.createReplayBuffer).mockReturnValue(handle as never);
  vi.mocked(buffer.tagSavedReplay).mockImplementation((id, source) => { const found = saved.find((c) => c.id === id); if (found) found.source = source; return found ?? null; });
  vi.mocked(buffer.removeSavedReplay).mockImplementation((id) => { saved = saved.filter((c) => c.id !== id); notify(); });
  vi.mocked(buffer.updateReplayTrim).mockReset();
  render45.mockReset();
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('Replay tab', () => {
  it('shows empty lists and notes when nothing is recorded', () => {
    mount('/competitions/1/stream-controls?tab=replay', []);
    expect(screen.getByText(/Replays are recorded from the video on this page/)).toBeInTheDocument();
    expect(screen.getByText('Each race is recorded here once it is scored.')).toBeInTheDocument();
    expect(screen.getByText('No saved replays')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Instant replay · 30s/ })).toBeDisabled();
  });

  it('records the video on the page and says so', () => {
    mount();
    expect(buffer.createReplayBuffer).toHaveBeenCalledWith(expect.objectContaining({ competitionId: 1, arenaName: 'Main Arena', streamId: 1 }));
    expect(screen.getByText(/Recording the video on this page/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Instant replay · 30s/ })).toBeEnabled();
  });

  it('remembers the instant replay length', async () => {
    const user = userEvent.setup();
    mount();
    const group = screen.getByRole('radiogroup', { name: 'Instant replay length' });
    expect(within(group).getByRole('radio', { name: 'Last 30s' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(group).getByRole('radio', { name: 'Last 1 min' }));
    expect(screen.getByRole('button', { name: /Instant replay · 1 min/ })).toBeInTheDocument();
    expect(localStorage.getItem('mg.instantReplaySeconds')).toBe('60');
  });

  it('saves an instant replay, opens it with Cancel clip, and discards it when cancelled', async () => {
    const user = userEvent.setup();
    mount('/competitions/1/stream-controls');
    await user.click(screen.getByRole('button', { name: /Instant replay · 30s/ }));
    await waitFor(() => expect(handle.saveClip).toHaveBeenCalledWith(expect.stringMatching(/^Instant replay \d\d:\d\d$/), expect.objectContaining({ durationSeconds: 30 })));
    expect(await screen.findByRole('tab', { name: 'Replay', selected: true })).toBeInTheDocument();
    expect(buffer.tagSavedReplay).toHaveBeenCalledWith('instant-1', 'instant');
    const cancel = await screen.findByRole('button', { name: 'Cancel clip' });
    expect(cancel).toHaveClass('rp-link');
    await user.click(cancel);
    expect(buffer.removeSavedReplay).toHaveBeenCalledWith('instant-1');
    expect(screen.queryByRole('region', { name: /^Replay:/ })).toBeNull();
    expect(screen.getByText('No saved replays')).toBeInTheDocument();
  });

  it('lists race recordings as watch-only, with no editing controls', async () => {
    const user = userEvent.setup();
    saved = [clip('Seniors · Race 1', { source: 'race', createdAt: '2026-06-01T10:05:00Z' }), clip('Older race', { source: 'race', createdAt: '2026-06-01T09:00:00Z' })];
    mount();
    const list = screen.getByLabelText('Race recordings');
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Seniors · Race 1'), expect.stringContaining('Older race')]);
    await user.click(within(list).getAllByRole('button', { name: /Watch/ })[0]);
    const player = screen.getByRole('region', { name: 'Replay: Seniors · Race 1' });
    expect(within(player).getByRole('button', { name: 'Play' })).toBeInTheDocument();
    for (const name of ['Start here', 'End here', 'Zoom in', 'Add keyframe', 'Slow-mo', 'Save clip', 'Reset framing', 'Remove', 'Cancel clip']) {
      expect(within(player).queryByRole('button', { name })).toBeNull();
    }
    expect(within(player).queryByRole('slider', { name: /Replay framing/ })).toBeNull();
    expect(screen.queryByText(/Drag the frame to follow the riders/)).toBeNull();
    await user.click(within(player).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: /^Replay:/ })).toBeNull();
  });

  it('opens and closes a saved replay from its row', async () => {
    const user = userEvent.setup();
    saved = [clip('Finish')];
    mount();
    await user.click(screen.getByRole('button', { name: /Finish/ }));
    expect(screen.getByRole('region', { name: 'Replay: Finish' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
    await user.click(within(screen.getByLabelText('Saved replays')).getByRole('button', { name: /Finish/ }));
    expect(screen.queryByRole('region', { name: 'Replay: Finish' })).toBeNull();
  });
});

describe('Replay editor', () => {
  async function openEditor() {
    const user = userEvent.setup();
    saved = [clip('Finish')];
    mount();
    await user.click(screen.getByRole('button', { name: /Finish/ }));
    const editor = screen.getByRole('region', { name: 'Replay: Finish' });
    const video = editor.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 20 });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    fireEvent.loadedMetadata(video);
    return { user, editor, video };
  }

  it('shows the editing controls for a saved replay, without Cancel clip', async () => {
    const { editor } = await openEditor();
    for (const name of ['Start here', 'End here', 'Zoom out', 'Zoom in', 'Add keyframe', 'Slow-mo', 'Save clip', 'Reset framing', 'Remove', 'Back 0.1 seconds', 'Forward 0.1 seconds', 'Play']) {
      expect(within(editor).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(editor).queryByRole('button', { name: 'Cancel clip' })).toBeNull();
    expect(within(editor).getByRole('slider', { name: 'Replay framing, drag to move' })).toBeInTheDocument();
    expect(within(editor).getByText('20.0s of 20s')).toBeInTheDocument();
  });

  it('steps through the video and sets where the cut starts and ends', async () => {
    const { user, editor, video } = await openEditor();
    await user.click(within(editor).getByRole('button', { name: 'Forward 0.1 seconds' }));
    expect(video.currentTime).toBeCloseTo(0.1);
    fireEvent.change(within(editor).getByRole('slider', { name: 'Playhead' }), { target: { value: '25' } });
    expect(video.currentTime).toBeCloseTo(5);
    await user.click(within(editor).getByRole('button', { name: 'Start here' }));
    fireEvent.change(within(editor).getByRole('slider', { name: 'Playhead' }), { target: { value: '75' } });
    await user.click(within(editor).getByRole('button', { name: 'End here' }));
    expect(within(editor).getByText('10.0s of 20s')).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'Back 0.1 seconds' }));
    expect(video.currentTime).toBeCloseTo(14.9);
    await waitFor(() => expect(buffer.updateReplayTrim).toHaveBeenLastCalledWith('Finish', 5, 15, expect.any(Array)));
  });

  it('ignores a start after the end and an end before the start', async () => {
    const { user, editor } = await openEditor();
    fireEvent.change(within(editor).getByRole('slider', { name: 'Playhead' }), { target: { value: '100' } });
    await user.click(within(editor).getByRole('button', { name: 'Start here' }));
    expect(within(editor).getByText('20.0s of 20s')).toBeInTheDocument();
    fireEvent.change(within(editor).getByRole('slider', { name: 'Playhead' }), { target: { value: '0' } });
    await user.click(within(editor).getByRole('button', { name: 'End here' }));
    expect(within(editor).getByText('20.0s of 20s')).toBeInTheDocument();
  });

  it('zooms, adds keyframes and resets the framing', async () => {
    const { user, editor } = await openEditor();
    const frame = within(editor).getByRole('slider', { name: 'Replay framing, drag to move' });
    expect(within(editor).getByText('0 keyframes')).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'Zoom in' }));
    expect(frame).toHaveAttribute('aria-valuetext', 'Centre 50% across, 50% down, 1.5× zoom');
    await user.click(within(editor).getByRole('button', { name: 'Zoom in' }));
    await user.click(within(editor).getByRole('button', { name: 'Zoom in' }));
    await user.click(within(editor).getByRole('button', { name: 'Zoom in' }));
    await user.click(within(editor).getByRole('button', { name: 'Zoom in' }));
    await user.click(within(editor).getByRole('button', { name: 'Zoom in' }));
    expect(within(editor).getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    await user.click(within(editor).getByRole('button', { name: 'Zoom out' }));
    expect(within(editor).getByText('1 keyframe')).toBeInTheDocument();
    fireEvent.change(within(editor).getByRole('slider', { name: 'Playhead' }), { target: { value: '50' } });
    await user.click(within(editor).getByRole('button', { name: 'Add keyframe' }));
    expect(within(editor).getByText('2 keyframes')).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'Reset framing' }));
    expect(within(editor).getByText('0 keyframes')).toBeInTheDocument();
  });

  it('moves the frame with the keyboard and by dragging', async () => {
    const { user, editor } = await openEditor();
    await user.click(within(editor).getByRole('button', { name: 'Zoom in' }));
    await user.click(within(editor).getByRole('button', { name: 'Zoom in' }));
    const frame = within(editor).getByRole('slider', { name: 'Replay framing, drag to move' });
    frame.focus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(frame).toHaveAttribute('aria-valuetext', 'Centre 52% across, 52% down, 2.0× zoom');
    await user.keyboard('{x}');
    expect(frame).toHaveAttribute('aria-valuetext', 'Centre 52% across, 52% down, 2.0× zoom');
    const stage = editor.querySelector('.rp-video') as HTMLElement;
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(frame, { clientX: 100, clientY: 50, pointerId: 1 });
    expect(frame).toHaveAttribute('data-drag', 'true');
    fireEvent.pointerMove(stage, { clientX: 120, clientY: 50 });
    expect(frame).toHaveAttribute('aria-valuetext', 'Centre 62% across, 52% down, 2.0× zoom');
    fireEvent.pointerUp(stage);
    expect(frame).toHaveAttribute('data-drag', 'false');
    fireEvent.pointerMove(stage, { clientX: 150, clientY: 50 });
    expect(frame).toHaveAttribute('aria-valuetext', 'Centre 62% across, 52% down, 2.0× zoom');
  });

  it('plays, pauses and slows down', async () => {
    const { user, editor, video } = await openEditor();
    await user.click(within(editor).getByRole('button', { name: 'Play' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(await within(editor).findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'Slow-mo' }));
    expect(within(editor).getByRole('button', { name: 'Slow-mo' })).toHaveAttribute('aria-pressed', 'true');
    expect(video.playbackRate).toBe(0.5);
    await user.click(within(editor).getByRole('button', { name: 'Pause' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(within(editor).getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('stops at the end of the cut', async () => {
    const { user, editor, video } = await openEditor();
    fireEvent.change(within(editor).getByRole('slider', { name: 'Playhead' }), { target: { value: '25' } });
    await user.click(within(editor).getByRole('button', { name: 'End here' }));
    fireEvent.change(within(editor).getByRole('slider', { name: 'Playhead' }), { target: { value: '0' } });
    await user.click(within(editor).getByRole('button', { name: 'Play' }));
    await act(async () => { video.currentTime = 6; await new Promise((resolve) => setTimeout(resolve, 50)); });
    await waitFor(() => expect(within(editor).getByRole('button', { name: 'Play' })).toBeInTheDocument());
    expect(video.currentTime).toBe(6);
  });

  it('saves a new clip with the framing baked in, then shows it', async () => {
    const user = userEvent.setup();
    saved = [clip('Finish')];
    const exported = clip('Finish cut', { savedHighlight: true });
    render45.mockImplementation(async () => { saved = [...saved, exported]; return exported; });
    mount();
    await user.click(screen.getByRole('button', { name: /Finish/ }));
    const editor = screen.getByRole('region', { name: 'Replay: Finish' });
    await user.click(within(editor).getByRole('button', { name: 'Zoom in' }));
    await user.click(within(editor).getByRole('button', { name: 'Save clip' }));
    await waitFor(() => expect(render45).toHaveBeenCalled());
    expect(render45.mock.calls[0][1]).toMatchObject({ id: 'Finish' });
    expect(render45.mock.calls[0][4]).toEqual([expect.objectContaining({ timeSec: 0, zoom: 1.5 })]);
    await notify();
    expect(await screen.findByRole('region', { name: 'Replay: Finish cut' })).toBeInTheDocument();
  });

  it('shows why a clip could not be saved', async () => {
    const user = userEvent.setup();
    saved = [clip('Finish')];
    render45.mockRejectedValue(new Error('Choose a start before the end of the clip.'));
    mount();
    await user.click(screen.getByRole('button', { name: /Finish/ }));
    await user.click(screen.getByRole('button', { name: 'Save clip' }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Choose a start before the end of the clip.');
  });

  it('removes a saved replay', async () => {
    const { user, editor } = await openEditor();
    await user.click(within(editor).getByRole('button', { name: 'Remove' }));
    expect(buffer.removeSavedReplay).toHaveBeenCalledWith('Finish');
    expect(screen.queryByRole('region', { name: 'Replay: Finish' })).toBeNull();
  });
});

describe('Race recordings from scored races', () => {
  const card = (key: string): QueuedScoreCard => ({ key, arenaName: 'Main Arena', heading: 'Seniors · Heat 1', card: { raceName: 'Race 2' } as never, receivedAt: 0 });

  it('keeps a 45 second recording when a race is scored and lists it for watching', async () => {
    const view = mount();
    view.scored([card('r1')]);
    view.scored([card('r1'), card('r2')]);
    await waitFor(() => expect(handle.saveClip).toHaveBeenCalledWith('Seniors · Heat 1 · Race 2', expect.objectContaining({ durationSeconds: 45 })));
    expect(buffer.tagSavedReplay).toHaveBeenCalledWith('instant-1', 'race');
    await waitFor(() => expect(within(screen.getByLabelText('Race recordings')).getByRole('button', { name: /Watch/ })).toBeInTheDocument());
  });
});
