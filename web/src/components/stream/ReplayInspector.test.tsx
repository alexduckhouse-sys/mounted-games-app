import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReplayInspector,
  SavedReplaysButton,
  SavedReplaysDrawer,
  capturePhotoFinishSnapshot,
  interpolateFollowTransform,
  renderTrimmedFollowClip,
} from './ReplayInspector';
import {
  addSavedReplay,
  clearSavedReplays,
  type FollowKeyframe,
  type SavedReplayClip,
} from '../../live/replayBuffer';

import { encodeReplay } from '../../live/replayEncoding';
vi.mock('../../live/replayEncoding', async (original) => ({ ...await original<typeof import('../../live/replayEncoding')>(), encodeReplay: vi.fn() }));
beforeEach(() => { vi.mocked(encodeReplay).mockResolvedValue(new Blob(['independently encoded video'], { type: 'video/webm' })); });

const createMockClip = (overrides: Partial<SavedReplayClip> = {}): SavedReplayClip => ({
  id: 'clip-test-1',
  competitionId: 42,
  streamId: 7,
  arenaName: 'Main Arena',
  label: 'Heat 3 Decider',
  createdAt: '2026-10-24T14:30:00Z',
  durationSeconds: 15,
  mimeType: 'video/webm',
  blob: new Blob(['mock video data'], { type: 'video/webm' }),
  url: 'blob:http://localhost/mock-video-url-1',
  savedHighlight: false,
  trimStartSeconds: 0,
  trimEndSeconds: 15,
  resolutionLabel: '1080p',
  ...overrides,
});

describe('ReplayInspector component', () => {
  let playSpy: ReturnType<typeof vi.fn>;
  let pauseSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearSavedReplays();
    playSpy = vi.fn().mockResolvedValue(undefined);
    pauseSpy = vi.fn();
    window.HTMLMediaElement.prototype.play = playSpy as unknown as () => Promise<void>;
    window.HTMLMediaElement.prototype.pause = pauseSpy as unknown as () => void;
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 });

    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => mockCtx as unknown as ReturnType<HTMLCanvasElement['getContext']>
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,mockpng');
  });

  afterEach(() => {
    clearSavedReplays();
    vi.restoreAllMocks();
  });

  it('renders inspector dialog with header, video, and closes on button or Escape key', () => {
    const clip = createMockClip();
    const onClose = vi.fn();

    const { unmount } = render(
      <ReplayInspector clip={clip} onClose={onClose} />
    );

    const dialog = screen.getByRole('dialog', { name: 'Replay inspector' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Heat 3 Decider')).toBeInTheDocument();
    expect(screen.getByText(/Main Arena/)).toBeInTheDocument();
    expect(screen.getByText('1080p')).toBeInTheDocument();

    const downloadLink = screen.getByRole('link', { name: 'Download replay' });
    expect(downloadLink).toHaveAttribute('href', clip.url);
    expect(downloadLink).toHaveAttribute('download', 'Heat_3_Decider_Main_Arena.webm');

    // Close button
    const closeBtn = screen.getByRole('button', { name: 'Close replay' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('supports zoom levels 1x-4x, pointer drag panning, and reset view', () => {
    const clip = createMockClip();
    render(<ReplayInspector clip={clip} onClose={vi.fn()} />);

    const video = screen.getByLabelText('Heat 3 Decider video') as HTMLVideoElement;
    expect(video.style.transform).toContain('scale(1)');

    // Reset view button shouldn't exist at 1x
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();

    // Zoom to 2x
    const zoom2x = screen.getByRole('button', { name: 'Zoom 2x' });
    fireEvent.click(zoom2x);
    expect(zoom2x).toHaveAttribute('aria-pressed', 'true');
    expect(video.style.transform).toContain('scale(2)');

    // Reset view button appears
    const resetBtn = screen.getByRole('button', { name: 'Reset view' });
    expect(resetBtn).toBeInTheDocument();

    // Pointer drag to pan
    const viewport = video.parentElement!;
    fireEvent.pointerDown(viewport, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 260, clientY: 230, pointerId: 1 });
    expect(video.style.transform).toContain('scale(2)');
    expect(video.style.transform).toContain('translate(');

    fireEvent.pointerUp(viewport, { pointerId: 1 });

    // Pointer down at 1x does not drag
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 1x' }));
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 150, clientY: 150, pointerId: 1 });

    // Zoom to 4x and then reset view
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 4x' }));
    expect(video.style.transform).toContain('scale(4)');
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(video.style.transform).toContain('scale(1)');
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
  });

  it('supports slow-motion speeds, play/pause toggle, frame stepping, and scrubber', () => {
    const clip = createMockClip({ durationSeconds: 12 });
    render(<ReplayInspector clip={clip} onClose={vi.fn()} />);

    const video = screen.getByLabelText('Heat 3 Decider video') as HTMLVideoElement;

    // Slow-Mo 0.25x Photo-Finish
    const speed025 = screen.getByRole('button', { name: 'Playback speed 0.25x' });
    fireEvent.click(speed025);
    expect(video.playbackRate).toBe(0.25);

    // Slow-Mo 0.5x
    const speed05 = screen.getByRole('button', { name: 'Playback speed 0.5x' });
    fireEvent.click(speed05);
    expect(video.playbackRate).toBe(0.5);

    // Normal 1x
    const speed1 = screen.getByRole('button', { name: 'Playback speed 1x' });
    fireEvent.click(speed1);
    expect(video.playbackRate).toBe(1);

    // Play / Pause toggle
    const playBtn = screen.getByRole('button', { name: 'Play replay' });
    fireEvent.click(playBtn);
    expect(playSpy).toHaveBeenCalled();
    fireEvent.play(video);

    expect(screen.getByRole('button', { name: 'Pause replay' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }));
    expect(pauseSpy).toHaveBeenCalled();
    fireEvent.pause(video);

    // Keyboard shortcuts: space or 'k' toggles play/pause
    fireEvent.keyDown(window, { key: ' ' });
    expect(playSpy).toHaveBeenCalled();

    // Frame stepping: +0.1s and -0.1s
    video.currentTime = 2.0;
    const stepFwd = screen.getByRole('button', { name: 'Step forward 0.1 seconds' });
    fireEvent.click(stepFwd);
    expect(video.currentTime).toBeCloseTo(2.1, 1);

    const stepBack = screen.getByRole('button', { name: 'Step back 0.1 seconds' });
    fireEvent.click(stepBack);
    expect(video.currentTime).toBeCloseTo(2.0, 1);

    // Keyboard frame stepping: ArrowRight and ArrowLeft
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(video.currentTime).toBeCloseTo(2.1, 1);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(video.currentTime).toBeCloseTo(2.0, 1);

    // Scrubber range input
    const scrubber = screen.getByRole('slider', { name: 'Timeline scrubber' });
    fireEvent.change(scrubber, { target: { value: '6.5' } });
    expect(video.currentTime).toBe(6.5);
  });

  it('handles trim sliders, In/Out buttons, looping playback, and replay clip button', () => {
    const clip = createMockClip({ durationSeconds: 10, trimStartSeconds: 1, trimEndSeconds: 6 });
    render(<ReplayInspector clip={clip} onClose={vi.fn()} />);

    const video = screen.getByLabelText('Heat 3 Decider video') as HTMLVideoElement;

    // Readout shows initial trim duration
    expect(screen.getByText(/Trimmed: 00:01.0 – 00:06.0 \(5.0s\)/)).toBeInTheDocument();

    const trimStartInput = screen.getByRole('slider', { name: 'Trim start' });
    const trimEndInput = screen.getByRole('slider', { name: 'Trim end' });

    // Change trim start to 2.5
    fireEvent.change(trimStartInput, { target: { value: '2.5' } });
    // Change trim end to 5.5
    fireEvent.change(trimEndInput, { target: { value: '5.5' } });

    // In/Out buttons: Set Start at playhead (clamps video.currentTime forward if < newStart)
    video.currentTime = 2.0;
    fireEvent.timeUpdate(video);
    video.currentTime = 1.0;
    const setStartBtn = screen.getByRole('button', { name: 'Set trim start at playhead' });
    fireEvent.click(setStartBtn);
    expect(video.currentTime).toBe(2.0);
    expect(screen.getByText(/Trimmed: 00:02.0 – 00:05.5 \(3.5s\)/)).toBeInTheDocument();

    // Set Start when video.currentTime is already at or above newStart
    video.currentTime = 2.5;
    fireEvent.timeUpdate(video);
    fireEvent.click(setStartBtn);

    // Set End at playhead (clamps video.currentTime back if > newEnd)
    video.currentTime = 4.0;
    fireEvent.timeUpdate(video);
    video.currentTime = 8.0;
    const setEndBtn = screen.getByRole('button', { name: 'Set trim end at playhead' });
    fireEvent.click(setEndBtn);
    expect(video.currentTime).toBe(4.0);
    expect(screen.getByText(/Trimmed: 00:02.5 – 00:04.0 \(1.5s\)/)).toBeInTheDocument();

    // Set End when video.currentTime is already at or below newEnd
    video.currentTime = 3.5;
    fireEvent.timeUpdate(video);
    fireEvent.click(setEndBtn);

    // Reset Trim restores to 0 and duration
    const resetTrimBtn = screen.getByRole('button', { name: 'Reset trim' });
    fireEvent.click(resetTrimBtn);
    expect(screen.getByText(/Trimmed: 00:00.0 – 00:10.0 \(10.0s\)/)).toBeInTheDocument();

    // Set trim end to 5.5 for looping test
    fireEvent.change(trimEndInput, { target: { value: '5.5' } });
    fireEvent.change(trimStartInput, { target: { value: '2.5' } });

    // Replay Clip button jumps to trimStart and plays
    const replayBtn = screen.getByRole('button', { name: 'Replay clip' });
    fireEvent.click(replayBtn);
    expect(video.currentTime).toBe(2.5);
    expect(playSpy).toHaveBeenCalled();

    // Looping: simulate video playing past trimEnd
    fireEvent.play(video);
    video.currentTime = 5.8;
    fireEvent.timeUpdate(video);
    // Should loop back to trimStart (2.5)
    expect(video.currentTime).toBe(2.5);
  });

  it('handles post-review decision bar: Save Highlight and Remove Line Review', async () => {
    const clip = createMockClip();
    addSavedReplay(clip);
    const onSaveHighlight = vi.fn();
    const onDeleteClip = vi.fn();
    const onClose = vi.fn();

    render(
      <ReplayInspector
        clip={clip}
        onSaveHighlight={onSaveHighlight}
        onDeleteClip={onDeleteClip}
        onClose={onClose}
      />
    );

    // Save highlight
    const saveHighlightBtn = screen.getByRole('button', { name: 'Save highlight' });
    fireEvent.click(saveHighlightBtn);
    await waitFor(() => expect(onSaveHighlight).toHaveBeenCalledWith(expect.objectContaining({ savedHighlight: true })));
    expect(onSaveHighlight.mock.calls[0][0].id).not.toBe(clip.id);

    // Remove line review
    const removeBtn = screen.getByRole('button', { name: 'Remove line review' });
    fireEvent.click(removeBtn);
    expect(onDeleteClip).toHaveBeenCalledWith(clip.id);
  });

  it('removes line review and calls onClose when onDeleteClip is not provided', () => {
    const clip = createMockClip();
    addSavedReplay(clip);
    const onClose = vi.fn();

    render(<ReplayInspector clip={clip} onClose={onClose} />);

    const removeBtn = screen.getByRole('button', { name: 'Remove line review' });
    fireEvent.click(removeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders horizontal strip when > 1 clips are provided and allows switching/deleting clips', () => {
    const clip1 = createMockClip({ id: 'c1', label: 'Race 1' });
    const clip2 = createMockClip({ id: 'c2', label: 'Race 2' });
    const onSelectClip = vi.fn();
    const onDeleteClip = vi.fn();

    const { rerender } = render(
      <ReplayInspector
        clip={clip1}
        clips={[clip1, clip2]}
        onSelectClip={onSelectClip}
        onDeleteClip={onDeleteClip}
        onClose={vi.fn()}
      />
    );

    const strip = screen.getByRole('region', { name: 'Saved clips' });
    expect(within(strip).getByText('Race 1')).toBeInTheDocument();
    expect(within(strip).getByText('Race 2')).toBeInTheDocument();

    // Click race 2 to select
    const race2Btn = within(strip).getByText('Race 2').closest('[role="button"]')!;
    fireEvent.click(race2Btn);
    expect(onSelectClip).toHaveBeenCalledWith(clip2);

    // Keydown Enter on clip
    fireEvent.keyDown(race2Btn, { key: 'Enter' });
    expect(onSelectClip).toHaveBeenCalledTimes(2);

    // Delete button inside strip
    const deleteBtn = screen.getByRole('button', { name: 'Delete replay Race 2' });
    fireEvent.click(deleteBtn);
    expect(onDeleteClip).toHaveBeenCalledWith('c2');

    // Rerender with single clip: strip should not appear
    rerender(
      <ReplayInspector
        clip={clip1}
        clips={[clip1]}
        onSelectClip={onSelectClip}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole('region', { name: 'Saved clips' })).toBeNull();
  });

  it('renders SavedReplaysDrawer, handles clip selection, deletion, and empty state', () => {
    const clip = createMockClip({ id: 'c-drawer', label: 'Drawer Clip' });
    const onSelectClip = vi.fn();
    const onDeleteClip = vi.fn();
    const onClose = vi.fn();

    // When open is false
    const { rerender } = render(
      <SavedReplaysDrawer
        open={false}
        competitionId={42}
        onClose={onClose}
        onSelectClip={onSelectClip}
      />
    );
    expect(screen.queryByRole('dialog', { name: 'Saved replays' })).toBeNull();

    // When open is true with no clips
    rerender(
      <SavedReplaysDrawer
        open={true}
        competitionId={42}
        onClose={onClose}
        onSelectClip={onSelectClip}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Saved replays' })).toBeInTheDocument();
    expect(screen.getByText('No saved replays yet')).toBeInTheDocument();

    // Add clip and rerender
    addSavedReplay(clip);
    rerender(
      <SavedReplaysDrawer
        open={true}
        competitionId={42}
        onClose={onClose}
        onSelectClip={onSelectClip}
        onDeleteClip={onDeleteClip}
      />
    );
    expect(screen.getByText('Drawer Clip')).toBeInTheDocument();

    // Select clip
    fireEvent.click(screen.getByText('Drawer Clip'));
    expect(onSelectClip).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-drawer' }));
    expect(onClose).toHaveBeenCalled();

    // Delete clip
    const deleteBtn = screen.getByRole('button', { name: 'Delete replay Drawer Clip' });
    fireEvent.click(deleteBtn);
    expect(onDeleteClip).toHaveBeenCalledWith('c-drawer');

    // Close button
    const closeBtn = screen.getByRole('button', { name: 'Close saved replays' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(2);

    // Download button inside drawer stops propagation
    const drawerDownloadLink = screen.getByRole('link', { name: 'Download replay Drawer Clip' });
    fireEvent.click(drawerDownloadLink);
    // Should NOT have called onSelectClip or onClose again
    expect(onSelectClip).toHaveBeenCalledTimes(1);

    // Quick-capture 30m rolling buffer buttons inside centred SavedReplaysDrawer
    const onCaptureBufferClip = vi.fn();
    rerender(
      <SavedReplaysDrawer
        open={true}
        competitionId={42}
        onClose={onClose}
        onSelectClip={onSelectClip}
        onDeleteClip={onDeleteClip}
        onCaptureBufferClip={onCaptureBufferClip}
        bufferedSeconds={120}
      />
    );
    expect(screen.getByText('120s buffered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save last 15s' }));
    expect(onCaptureBufferClip).toHaveBeenCalledWith(15);
    fireEvent.click(screen.getByRole('button', { name: 'Save full buffer (30m)' }));
    expect(onCaptureBufferClip).toHaveBeenCalledWith(1800);

    // Without bufferedSeconds prop, shows 'Ready'
    rerender(
      <SavedReplaysDrawer
        open={true}
        competitionId={42}
        onClose={onClose}
        onSelectClip={onSelectClip}
        onCaptureBufferClip={onCaptureBufferClip}
      />
    );
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('renders SavedReplaysButton filtered by arenaName and triggers onSelectClip', () => {
    const onSelectClip = vi.fn();

    const clipA = createMockClip({ id: 'cA', competitionId: 55, arenaName: 'Arena Alpha', label: 'Clip A' });
    const clipB = createMockClip({ id: 'cB', competitionId: 55, arenaName: 'Arena Beta', label: 'Clip B' });
    addSavedReplay(clipA);
    addSavedReplay(clipB);

    const { rerender } = render(
      <SavedReplaysButton competitionId={55} arenaName="Arena Beta" onSelectClip={onSelectClip} />
    );

    const button = screen.getByRole('button', { name: 'Saved replays (1)' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('Replays (1)');

    fireEvent.click(button);
    expect(onSelectClip).toHaveBeenCalledWith(expect.objectContaining({ id: 'cB' }));

    // Unmatched arena returns null
    rerender(
      <SavedReplaysButton competitionId={55} arenaName="Arena Gamma" onSelectClip={onSelectClip} />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('handles keyboard shortcuts with input focus, clamp bounds, and loadedmetadata', () => {
    const clip = createMockClip({ durationSeconds: 20, trimStartSeconds: 2, trimEndSeconds: 8 });
    render(<ReplayInspector clip={clip} onClose={vi.fn()} />);

    const video = screen.getByLabelText('Heat 3 Decider video') as HTMLVideoElement;

    // Loaded metadata event updates duration
    Object.defineProperty(video, 'duration', { configurable: true, value: 25 });
    fireEvent.loadedMetadata(video);

    // Pressing Space while focused on scrubber input is ignored
    const scrubber = screen.getByRole('slider', { name: 'Timeline scrubber' });
    scrubber.focus();
    fireEvent.keyDown(scrubber, { key: ' ' });
    expect(playSpy).not.toHaveBeenCalled();

    // Pressing 'k' toggles play
    fireEvent.keyDown(window, { key: 'k' });
    expect(playSpy).toHaveBeenCalled();

    // Clamping step back to 0
    video.currentTime = 0.05;
    const stepBack = screen.getByRole('button', { name: 'Step back 0.1 seconds' });
    fireEvent.click(stepBack);
    expect(video.currentTime).toBe(0);

    // Clamping step forward to duration
    video.currentTime = 24.95;
    const stepFwd = screen.getByRole('button', { name: 'Step forward 0.1 seconds' });
    fireEvent.click(stepFwd);
    expect(video.currentTime).toBe(25);

    // Toggle play when currentTime is past trimEnd restarts at trimStart
    video.currentTime = 12;
    const playBtn = screen.getByRole('button', { name: 'Play replay' });
    fireEvent.click(playBtn);
    expect(video.currentTime).toBe(2);

    // Pointer cancel during dragging
    const zoom2x = screen.getByRole('button', { name: 'Zoom 2x' });
    fireEvent.click(zoom2x);
    const viewport = video.parentElement!;
    fireEvent.pointerDown(viewport, { clientX: 200, clientY: 200, pointerId: 2 });
    fireEvent.pointerCancel(viewport, { pointerId: 2 });
  });

  it('supports Space key on clip in strip and pan clamping at boundaries', () => {
    const clip1 = createMockClip({ id: 'c1', label: 'Race 1' });
    const clip2 = createMockClip({ id: 'c2', label: 'Race 2' });
    const onSelectClip = vi.fn();

    render(
      <ReplayInspector
        clip={clip1}
        clips={[clip1, clip2]}
        onSelectClip={onSelectClip}
        onClose={vi.fn()}
      />
    );

    const strip = screen.getByRole('region', { name: 'Saved clips' });
    const race2Btn = within(strip).getByText('Race 2').closest('[role="button"]')!;

    // Space key on strip clip
    fireEvent.keyDown(race2Btn, { key: ' ' });
    expect(onSelectClip).toHaveBeenCalledWith(clip2);

    // Extreme pointer drag clamping
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 3x' }));
    const video = screen.getByLabelText('Race 1 video') as HTMLVideoElement;
    const viewport = video.parentElement!;
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, pointerId: 3 });
    // Huge drag delta
    fireEvent.pointerMove(viewport, { clientX: 5000, clientY: 5000, pointerId: 3 });
    fireEvent.pointerUp(viewport, { pointerId: 3 });
    expect(video.style.transform).toContain('scale(3)');
  });

  it('handles play rejection, button focus keydown, trim non-adjustments, and backdrop clicks', async () => {
    // Pointer capture mock
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();

    // Clip with savedHighlight=true and no resolutionLabel, and invalid createdAt
    const clip = createMockClip({
      savedHighlight: true,
      resolutionLabel: undefined,
      createdAt: 'invalid-date',
      durationSeconds: 10,
      trimStartSeconds: 2,
      trimEndSeconds: 8,
    });

    const onClose = vi.fn();
    const { rerender } = render(<ReplayInspector clip={clip} onClose={onClose} />);

    expect(screen.getByText('Highlight')).toBeInTheDocument();
    expect(screen.queryByText('1080p')).toBeNull();

    const video = screen.getByLabelText('Heat 3 Decider video') as HTMLVideoElement;

    // Rejecting play in togglePlay
    playSpy.mockRejectedValueOnce(new Error('Autoplay blocked'));
    const playBtn = screen.getByRole('button', { name: 'Play replay' });
    fireEvent.click(playBtn);
    await Promise.resolve();

    // Rejecting play in handleReplayClip
    playSpy.mockRejectedValueOnce(new Error('Replay blocked'));
    const replayBtn = screen.getByRole('button', { name: 'Replay clip' });
    fireEvent.click(replayBtn);
    await Promise.resolve();

    // Keydown while focused on button is ignored
    playBtn.focus();
    fireEvent.keyDown(playBtn, { key: ' ' });

    // Keydown with unrelated key
    fireEvent.keyDown(window, { key: 'KeyZ' });

    // Trim start change when video.currentTime is already >= val
    video.currentTime = 5;
    const trimStartSlider = screen.getByRole('slider', { name: 'Trim start' });
    fireEvent.change(trimStartSlider, { target: { value: '3' } });
    expect(video.currentTime).toBe(5);

    // Trim end change when video.currentTime is already <= val
    video.currentTime = 5;
    const trimEndSlider = screen.getByRole('slider', { name: 'Trim end' });
    fireEvent.change(trimEndSlider, { target: { value: '7' } });
    expect(video.currentTime).toBe(5);

    // Save highlight without onSaveHighlight prop provided
    const saveHighlightBtn = screen.getByRole('button', { name: 'Save highlight' });
    fireEvent.click(saveHighlightBtn);

    // Pointer down and up with setPointerCapture supported
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 2x' }));
    const viewport = video.parentElement!;
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, pointerId: 4 });
    expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(4);
    fireEvent.pointerUp(viewport, { pointerId: 4 });
    expect(Element.prototype.releasePointerCapture).toHaveBeenCalledWith(4);

    // Drawer backdrop click and inner sheet stopPropagation
    const onSelectClip = vi.fn();
    rerender(
      <SavedReplaysDrawer
        open={true}
        onClose={onClose}
        onSelectClip={onSelectClip}
      />
    );
    const drawerDialog = screen.getByRole('dialog', { name: 'Saved replays' });
    fireEvent.click(drawerDialog);
    expect(onClose).toHaveBeenCalled();

    // Click inside modal content should stop propagation
    const drawerTitle = screen.getByText('Saved Replays');
    fireEvent.click(drawerTitle);
    // Should not call onClose again
    expect(onClose).toHaveBeenCalledTimes(1);

    // SavedReplaysButton with className
    addSavedReplay(clip);
    rerender(
      <SavedReplaysButton
        competitionId={42}
        className="custom-review-button"
        onSelectClip={onSelectClip}
      />
    );
    const button = screen.getByRole('button', { name: /^Saved replays/ });
    expect(button).toHaveClass('custom-review-button');
  });

  it('covers null video ref, boundary branches, shortcuts, and fallback options', async () => {
    // 1. Test null videoRef
    const nullClip = createMockClip({
      id: 'clip-null',
      durationSeconds: 0,
      trimStartSeconds: undefined,
      trimEndSeconds: undefined,
    });
    let mockCurrent: HTMLVideoElement | null = null;
    const controllableRef = {
      get current() {
        return mockCurrent;
      },
      set current(_: HTMLVideoElement | null) {},
    };
    const onSelectClip = vi.fn();
    const onSaveHighlight = vi.fn();

    const { rerender } = render(
      <ReplayInspector
        clip={nullClip}
        onClose={vi.fn()}
        videoRef={controllableRef}
        onSaveHighlight={onSaveHighlight}
      />
    );

    // Play/Pause, Replay, Frame Step when video is null
    fireEvent.click(screen.getByRole('button', { name: 'Play replay' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replay clip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step forward 0.1 seconds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step back 0.1 seconds' }));

    // Seek, Speed, and Trim when videoRef is null
    fireEvent.change(screen.getByRole('slider', { name: 'Timeline scrubber' }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 0.5x' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Trim start' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Trim end' }), { target: { value: '12' } });

    // Time update when videoRef is null
    const video = screen.getByLabelText('Heat 3 Decider video') as HTMLVideoElement;
    fireEvent.timeUpdate(video);

    // Now attach video to controllableRef for subsequent tests
    mockCurrent = video;

    // Save highlight when clip is not in store
    fireEvent.click(screen.getByRole('button', { name: 'Save highlight' }));
    await screen.findByRole('alert');
    expect(onSaveHighlight).not.toHaveBeenCalled();

    // 2. Pointer up when not dragging
    const viewport = video.parentElement!;
    fireEvent.pointerUp(viewport, { pointerId: 10 });

    // 3. Trim end when video.currentTime > new trim end value
    video.currentTime = 10;
    fireEvent.change(screen.getByRole('slider', { name: 'Trim end' }), { target: { value: '5' } });
    expect(video.currentTime).toBe(5);

    // 4. Looping playback when playing and nowTime < trimEnd (does not loop)
    fireEvent.play(video);
    video.currentTime = 3;
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(3);

    // 5. Video duration 0 or NaN onLoadedMetadata
    Object.defineProperty(video, 'duration', { value: 0, writable: true });
    fireEvent.loadedMetadata(video);

    // 6. Keyboard shortcut 'k' to toggle play (pauses because playing)
    fireEvent.keyDown(window, { key: 'k' });
    expect(pauseSpy).toHaveBeenCalled();

    // 7. Re-render with new clip having negative duration to test formatVideoTime
    const negativeClip = createMockClip({
      id: 'clip-neg',
      durationSeconds: -5,
      trimStartSeconds: undefined,
      trimEndSeconds: undefined,
    });
    rerender(
      <ReplayInspector
        clip={negativeClip}
        onClose={vi.fn()}
      />
    );
    expect(screen.getAllByText(/00:00.0/).length).toBeGreaterThanOrEqual(1);

    // Re-render with clip having NaN duration
    const nanClip = createMockClip({
      id: 'clip-nan',
      durationSeconds: NaN,
      trimStartSeconds: undefined,
      trimEndSeconds: undefined,
    });
    rerender(
      <ReplayInspector
        clip={nanClip}
        onClose={vi.fn()}
      />
    );

    // 8. SavedReplaysButton without arenaName
    rerender(
      <SavedReplaysButton
        competitionId={42}
        onSelectClip={onSelectClip}
      />
    );

    // 9. SavedReplaysDrawer without onDeleteClip
    rerender(
      <SavedReplaysDrawer
        open={true}
        onClose={vi.fn()}
        onSelectClip={onSelectClip}
      />
    );

    // 10. Strip card keyboard events: Enter and non-selection keys
    const multiClips = [
      createMockClip({ id: 'c-1', label: 'Race 1' }),
      createMockClip({ id: 'c-2', label: 'Race 2' }),
    ];
    rerender(
      <ReplayInspector
        clip={multiClips[0]}
        clips={multiClips}
        onSelectClip={onSelectClip}
        onClose={vi.fn()}
      />
    );
    const stripCard = screen.getByText('Race 2').closest('[role="button"]')!;
    fireEvent.keyDown(stripCard, { key: 'ArrowDown' });
    expect(onSelectClip).not.toHaveBeenCalled();
    fireEvent.keyDown(stripCard, { key: 'Enter' });
    expect(onSelectClip).toHaveBeenCalledWith(multiClips[1]);
  });

  it('handles follow zoom controls, keyframe recording, arena presets, focal zoom, and region focus', async () => {
    const clip = createMockClip({ durationSeconds: 12, trimStartSeconds: 0, trimEndSeconds: 12 });
    const onSaveHighlight = vi.fn();
    render(<ReplayInspector clip={clip} onClose={vi.fn()} onSaveHighlight={onSaveHighlight} />);

    const video = screen.getByLabelText('Heat 3 Decider video') as HTMLVideoElement;
    const viewport = video.parentElement!;

    // Mock bounding rect for focal-point zoom calculations
    viewport.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));

    // Double-click viewport to focal zoom
    fireEvent.doubleClick(viewport, { clientX: 200, clientY: 150 });
    expect(video.style.transform).toContain('scale(2)');

    // 1-Tap Arena Region Focus Pills
    const focusLeftBtn = screen.getByRole('button', { name: 'Focus left start/finish' });
    fireEvent.click(focusLeftBtn);
    expect(video.style.transform).toContain('translate(160px, 0px)');

    const focusCentreBtn = screen.getByRole('button', { name: 'Focus centre' });
    fireEvent.click(focusCentreBtn);
    expect(video.style.transform).toContain('translate(0px, 0px)');

    const focusRightBtn = screen.getByRole('button', { name: 'Focus right changeover' });
    fireEvent.click(focusRightBtn);
    expect(video.style.transform).toContain('translate(-160px, 0px)');

    // Reset to zoom 1x so addKeyframe tests zoom <= 1 branch
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 1x' }));

    // Add Keyframe button (with zoom <= 1 sets zoom to 2)
    video.currentTime = 1.0;
    fireEvent.timeUpdate(video);
    const addKeyframeBtn = screen.getByRole('button', { name: 'Add follow keyframe' });
    fireEvent.click(addKeyframeBtn);
    expect(screen.getAllByTestId('follow-keyframe-dot')).toHaveLength(1);

    // Record Follow toggle
    const recordFollowBtn = screen.getByRole('button', { name: 'Record follow zoom' });
    fireEvent.click(recordFollowBtn);
    expect(recordFollowBtn).toHaveAttribute('aria-pressed', 'true');

    // With Record Follow active, changing zoom records keyframe
    video.currentTime = 3.0;
    fireEvent.timeUpdate(video);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 3x' }));
    expect(screen.getAllByTestId('follow-keyframe-dot')).toHaveLength(2);

    // With Record Follow active, focus region records keyframe
    fireEvent.click(focusLeftBtn);

    // With Record Follow active, pointer drag records keyframe
    fireEvent.pointerDown(viewport, { clientX: 200, clientY: 200, pointerId: 5 });
    fireEvent.pointerMove(viewport, { clientX: 250, clientY: 250, pointerId: 5 });
    fireEvent.pointerUp(viewport, { pointerId: 5 });

    // Double-click while recording also records
    video.currentTime = 5.0;
    fireEvent.timeUpdate(video);
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });

    // Double-click when bounding rect is null
    viewport.getBoundingClientRect = vi.fn(() => null as unknown as DOMRect);
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });

    // Turn off recording
    fireEvent.click(recordFollowBtn);
    expect(recordFollowBtn).toHaveAttribute('aria-pressed', 'false');

    // Playback interpolation: timeUpdate at mid time (interpolating between keyframe at 1.0 and 3.0)
    video.currentTime = 2.0;
    fireEvent.timeUpdate(video);
    expect(video.style.transform).toContain('scale(2.5)');

    // Seek interpolation
    const scrubber = screen.getByRole('slider', { name: 'Timeline scrubber' });
    fireEvent.change(scrubber, { target: { value: '1.0' } });
    expect(video.style.transform).toContain('scale(2)');

    // Step frame interpolation
    const stepFwdBtn = screen.getByRole('button', { name: 'Step forward 0.1 seconds' });
    fireEvent.click(stepFwdBtn);

    // Photo Finish snapshot button
    const photoFinishBtn = screen.getByRole('button', { name: 'Photo finish snapshot' });
    fireEvent.click(photoFinishBtn);
    expect(screen.getByRole('status')).toHaveTextContent(/Photo finish saved/);

    // Save highlight exports trimmed clip with keyframes
    const saveHighlightBtn = screen.getByRole('button', { name: 'Save highlight' });
    fireEvent.click(saveHighlightBtn);
    await waitFor(() => expect(onSaveHighlight).toHaveBeenCalledWith(expect.objectContaining({ savedHighlight: true, followKeyframes: undefined })));
    expect(vi.mocked(encodeReplay).mock.calls.at(-1)![1]?.transform).toBeTypeOf('function');

    // Clear follow keyframes
    const clearFollowBtn = screen.getByRole('button', { name: 'Clear follow keyframes' });
    fireEvent.click(clearFollowBtn);
    expect(screen.queryByTestId('follow-keyframe-dot')).toBeNull();
    expect(video.style.transform).toContain('scale(1)');
  });
  it('keeps a finite timeline when a live WebM reports unknown duration', () => {
    render(<ReplayInspector clip={createMockClip()} onClose={vi.fn()} />);
    const video = screen.getByLabelText('Heat 3 Decider video');
    Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
    fireEvent.loadedMetadata(video);
    expect(screen.getByLabelText('Timeline scrubber')).toHaveAttribute('max', '15');
  });
  it('uses displayed video dimensions for a letterboxed follow-cam export', async () => {
    const onSave = vi.fn(); render(<ReplayInspector clip={createMockClip()} onClose={vi.fn()} onSaveHighlight={onSave} />);
    const video = screen.getByLabelText('Heat 3 Decider video');
    Object.defineProperty(video, 'clientWidth', { configurable: true, value: 360 });
    Object.defineProperty(video, 'clientHeight', { configurable: true, value: 202.5 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 2x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add follow keyframe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save highlight' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(vi.mocked(encodeReplay).mock.calls.at(-1)![1]?.transform?.(0, 1920, 1080)).toEqual({ zoom: 2, panX: 0, panY: 0 });
  });
  it('shows when a clip needs downloading before the tab closes', () => {
    render(<ReplayInspector clip={createMockClip({ storageWarning: 'This replay is only available in this tab. Download it before leaving.' })} onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Download it before leaving');
  });

  it('exports and downloads MP4 with its actual format, including the saved drawer', async () => {
    const clip = createMockClip({ mimeType: 'video/mp4' }); const onSave = vi.fn();
    vi.mocked(encodeReplay).mockResolvedValueOnce(new Blob(['encoded mp4'], { type: 'video/mp4' }));
    const view = render(<ReplayInspector clip={clip} onClose={vi.fn()} onSaveHighlight={onSave} />);
    expect(screen.getByRole('link', { name: 'Download replay' })).toHaveAttribute('download', 'Heat_3_Decider_Main_Arena.mp4');
    fireEvent.click(screen.getByRole('button', { name: 'Save highlight' })); await waitFor(() => expect(onSave).toHaveBeenCalled()); view.unmount();
    render(<SavedReplaysDrawer competitionId={42} open onClose={vi.fn()} onSelectClip={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Download replay Heat 3 Decider' })).toHaveAttribute('download', 'Heat_3_Decider.mp4');
    expect(screen.getByText(/only available in this tab/)).toBeInTheDocument();
  });
  it('scales a stored follow path for a resized video and clears it without leaving an old crop', () => {
    const keys = [{ timeSec: 0, zoom: 2, panX: 30, panY: 10, viewportWidth: 360, viewportHeight: 202.5 }];
    render(<ReplayInspector clip={createMockClip({ followKeyframes: keys })} onClose={vi.fn()} />);
    const video = screen.getByLabelText('Heat 3 Decider video') as HTMLVideoElement;
    Object.defineProperty(video, 'clientWidth', { configurable: true, value: 720 }); Object.defineProperty(video, 'clientHeight', { configurable: true, value: 405 });
    fireEvent.timeUpdate(video); expect(video.style.transform).toContain('translate(60px, 20px)');
    fireEvent.click(screen.getByRole('button', { name: 'Clear follow keyframes' })); fireEvent.timeUpdate(video); expect(video.style.transform).toContain('scale(1)');
  });
  it('keeps snapshot failures visible and never offers a fake download before video has loaded', () => {
    render(<ReplayInspector clip={createMockClip()} onClose={vi.fn()} />);
    const video = screen.getByLabelText('Heat 3 Decider video');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 0 }); Object.defineProperty(video, 'videoHeight', { configurable: true, value: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Photo finish snapshot' })); expect(screen.getByText(/Wait for the replay video to load/)).toBeInTheDocument();
  });
  it('reports a browser canvas failure while taking a photo finish', () => {
    render(<ReplayInspector clip={createMockClip()} onClose={vi.fn()} />);
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => { throw 'Browser failed'; });
    fireEvent.click(screen.getByRole('button', { name: 'Photo finish snapshot' })); expect(screen.getByText('Couldn’t save the photo. Try again.')).toBeInTheDocument(); expect(screen.getByRole('alert')).toContainElement(screen.getByRole('button', { name: 'Try again' }));
  });

});

describe('interpolateFollowTransform', () => {
  it('returns null for empty or null keyframes', () => {
    expect(interpolateFollowTransform([], 5)).toBeNull();
    expect(interpolateFollowTransform(null as unknown as FollowKeyframe[], 5)).toBeNull();
  });

  it('clamps to first keyframe when before first timestamp', () => {
    const kf: FollowKeyframe[] = [
      { timeSec: 2, zoom: 2, panX: 50, panY: 10 },
      { timeSec: 8, zoom: 3, panX: -50, panY: -10 },
    ];
    const res = interpolateFollowTransform(kf, 1.0);
    expect(res).toEqual({ zoom: 2, panX: 50, panY: 10 });
  });

  it('clamps to last keyframe when after last timestamp', () => {
    const kf: FollowKeyframe[] = [
      { timeSec: 2, zoom: 2, panX: 50, panY: 10 },
      { timeSec: 8, zoom: 3, panX: -50, panY: -10 },
    ];
    const res = interpolateFollowTransform(kf, 10.0);
    expect(res).toEqual({ zoom: 3, panX: -50, panY: -10 });
  });

  it('interpolates linearly between keyframes', () => {
    const kf: FollowKeyframe[] = [
      { timeSec: 0, zoom: 1, panX: 0, panY: 0 },
      { timeSec: 10, zoom: 3, panX: 100, panY: 50 },
    ];
    const res = interpolateFollowTransform(kf, 5.0);
    expect(res).toEqual({ zoom: 2, panX: 50, panY: 25 });
  });
});

describe('capturePhotoFinishSnapshot', () => {
  it('never downloads a fake image when video or canvas capture is unavailable', () => {
    const clip = createMockClip();
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    expect(() => capturePhotoFinishSnapshot(null, clip, 0, { zoom: 1, panX: 0, panY: 0 })).toThrow('load');
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    expect(() => capturePhotoFinishSnapshot(video, clip, 0, { zoom: 1, panX: 0, panY: 0 })).toThrow('photo');
  });
});

describe('renderTrimmedFollowClip', () => {
  it('bakes follow transform and exports trimmed clip', async () => {
    const clip = createMockClip({ durationSeconds: 20 });
    const keyframes: FollowKeyframe[] = [{ timeSec: 2, zoom: 2, panX: 0, panY: 0 }];
    const mockVideo = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const res = await renderTrimmedFollowClip(mockVideo, clip, 2, 8, keyframes, {
      zoom: 1,
      panX: 0,
      panY: 0,
    });
    expect(res.savedHighlight).toBe(true);
    expect(res.trimStartSec).toBe(0);
    expect(res.trimEndSec).toBe(6);
    expect(vi.mocked(encodeReplay).mock.calls.at(-1)![1]?.transform?.(0, 1920, 1080)).toEqual({ zoom: 2, panX: 0, panY: 0 });

    // With null video and valid context
    const resWithCtxNullVid = await renderTrimmedFollowClip(null, clip, 0, 20, [], {
      zoom: 1,
      panX: 0,
      panY: 0,
    });
    expect(resWithCtxNullVid.savedHighlight).toBe(true);

    // With null video and null context
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    const res2 = await renderTrimmedFollowClip(null, clip, 0, 20, [], {
      zoom: 1,
      panX: 0,
      panY: 0,
    });
    expect(res2.savedHighlight).toBe(true);
  });
});

describe('ReplayInspector followKeyframes initialization and sync', () => {
  it('initializes and synchronises with followKeyframes on the clip', () => {
    const clipWithKf = createMockClip({
      id: 'clip-with-kf',
      durationSeconds: 15,
      followKeyframes: [{ timeSec: 2, zoom: 2, panX: 10, panY: 0 }],
    });
    const clipWithoutKf = createMockClip({
      id: 'clip-without-kf',
      durationSeconds: 15,
      followKeyframes: [{ timeSec: 4, zoom: 3, panX: 20, panY: 0 }],
    });
    const { rerender } = render(
      <ReplayInspector clip={clipWithKf} clips={[clipWithKf, clipWithoutKf]} onClose={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Clear follow keyframes' })).toBeInTheDocument();

    // Change active clip to another clip with followKeyframes to test useEffect branch
    rerender(
      <ReplayInspector clip={clipWithoutKf} clips={[clipWithKf, clipWithoutKf]} onClose={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Clear follow keyframes' })).toBeInTheDocument();
  });

  it('records keyframe with existing zoom > 1 when Add Keyframe is clicked', () => {
    const clip = createMockClip();
    render(<ReplayInspector clip={clip} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 3x' }));
    const video = screen.getByLabelText('Heat 3 Decider video') as HTMLVideoElement;
    video.currentTime = 1.5;
    fireEvent.timeUpdate(video);
    const addKeyframeBtn = screen.getByRole('button', { name: 'Add follow keyframe' });
    fireEvent.click(addKeyframeBtn);
    expect(screen.getAllByTestId('follow-keyframe-dot')).toHaveLength(1);
  });
});

it('maps letterboxed vertical movement to source pixels without changing the crop', async () => {
  const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
  await renderTrimmedFollowClip(video, createMockClip(), 0, 5,
    [{ timeSec: 0, zoom: 2, panX: 0, panY: 50, viewportWidth: 360, viewportHeight: 202.5 }], { zoom: 1, panX: 0, panY: 0 });
  const result = vi.mocked(encodeReplay).mock.calls.at(-1)![1]?.transform?.(0, 1920, 1080);
  expect(result?.panY).toBeCloseTo(266.6667); expect(result?.zoom).toBe(2);
});

it('bakes the current crop when no follow keyframes were recorded', async () => {
  const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
  await renderTrimmedFollowClip(video, createMockClip(), 0, 5, [], { zoom: 2, panX: 10, panY: 20, viewportWidth: 960, viewportHeight: 540 });
  expect(vi.mocked(encodeReplay).mock.calls.at(-1)![1]?.transform?.(0, 1920, 1080)).toEqual({ zoom: 2, panX: 20, panY: 40 });
  await renderTrimmedFollowClip(video, createMockClip(), 0, 5, [], { zoom: 2, panX: 10, panY: 20 });
  expect(vi.mocked(encodeReplay).mock.calls.at(-1)![1]?.transform?.(0, 1920, 1080)).toEqual({ zoom: 2, panX: 10, panY: 20 });
});
it('refuses invalid canvas image output instead of downloading a corrupted photo', () => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:,');
  expect(() => capturePhotoFinishSnapshot({ videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement, createMockClip(), 0, { zoom: 1, panX: 0, panY: 0 })).toThrow('photo');
});
