import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StreamChips } from './StreamChips';
import { StreamNotice, StreamOverlays } from './StreamOverlays';
import { StreamPlayer } from './StreamPlayer';
import { CompStreamCard, LiveVideo } from './LiveVideo';
import { chat, session } from '../../test/factories';
import { asMedia, FakeMediaStream, FakePeer, fakePeerConstructor, fakeStreamConstructor, flush, liveStream, resetMedia } from '../../test/streamFakes';
import * as replayBuffers from '../../live/replayBuffer';
import { deferred } from '../../test/streamFakes';
import type { StreamInvoke } from '../../live/streamRuntime';

const play = vi.fn(async () => {});
const requestFullscreen = vi.fn(async () => {});
const exitFullscreen = vi.fn(async () => {});
const lock = vi.fn(async () => {}), unlock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); resetMedia();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: requestFullscreen });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  Object.defineProperty(screen, 'orientation', { configurable: true, value: { lock, unlock } });
  Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { lock, unlock } });
  vi.spyOn(window.history, 'back').mockImplementation(() => {});
  play.mockResolvedValue(); requestFullscreen.mockResolvedValue(); exitFullscreen.mockResolvedValue(); lock.mockResolvedValue();
});
afterEach(() => { vi.useRealTimers(); });
const settle = () => act(flush);
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it('only offers arena and angle chips when there is a choice, preserving the selected arena', () => {
  const a = liveStream(), b = liveStream({ id: 2, angleName: 'Finish line' }), c = liveStream({ id: 3, arenaName: 'Second Arena' });
  const select = vi.fn(); const { rerender } = render(<StreamChips streams={[a]} selected={a} onSelect={select} />);
  expect(screen.queryByRole('group')).toBeNull();
  rerender(<StreamChips streams={[a, b, c]} selected={a} onSelect={select} />);
  expect(screen.getByRole('button', { name: 'Main Arena' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Finish line' })); expect(select).toHaveBeenLastCalledWith(2);
  fireEvent.click(screen.getByRole('button', { name: 'Second Arena' })); expect(select).toHaveBeenLastCalledWith(3);
  rerender(<StreamChips streams={[a, b, c]} selected={c} onSelect={select} />);
  expect(screen.queryByRole('group', { name: 'Camera angle' })).toBeNull();
});
it('shows live count, racing caption, sound affordance and extensible overlays', () => {
  const onSound = vi.fn(); const { rerender } = render(<StreamOverlays stream={liveStream()} label="Seniors · Heat 2" reconnecting={false} muted onSound={onSound}><p>Future score card</p></StreamOverlays>);
  expect(screen.getByText('12 watching')).toBeVisible(); expect(screen.getByText('Seniors · Heat 2')).toBeVisible();
  expect(screen.getByText('Future score card')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Tap for sound' })); expect(onSound).toHaveBeenCalled();
  for (const stream of [liveStream({ hasAudio: false }), liveStream({ audioMuted: true }), liveStream({ status: 1 })]) {
    rerender(<StreamOverlays stream={stream} label="Final" reconnecting muted onSound={onSound} />); expect(screen.queryByRole('button', { name: 'Tap for sound' })).toBeNull();
  }
  expect(screen.getByText('Back soon')).toBeVisible(); expect(screen.queryByText('Reconnecting…')).toBeNull();
  expect(screen.getByText('Back soon').parentElement).toHaveClass('bg-[rgb(var(--mg-header-deep))]');
  rerender(<StreamOverlays stream={liveStream()} label="Final" reconnecting muted={false} onSound={onSound} />);
  expect(screen.getByText('Reconnecting…')).toBeVisible(); expect(screen.queryByRole('button', { name: 'Tap for sound' })).toBeNull();
});
it('labels the strip by what is known: a caption, the racing heat, or just the camera', () => {
  const { rerender } = render(<StreamOverlays stream={liveStream({ arenaName: 'Main Arena', angleName: 'Finish line' })} label={null} reconnecting={false} muted={false} onSound={vi.fn()} />);
  expect(screen.getByText('Live from')).toBeVisible(); expect(screen.getByText('Main Arena · Finish line')).toBeVisible();
  rerender(<StreamOverlays stream={liveStream()} label="Seniors · Heat 2" reconnecting={false} muted={false} onSound={vi.fn()} />);
  expect(screen.getByText('Now racing')).toBeVisible();
  rerender(<StreamOverlays stream={liveStream({ caption: 'Lunch break' })} label="Lunch break" reconnecting={false} muted={false} onSound={vi.fn()} />);
  expect(screen.getByText('Now')).toBeVisible(); expect(screen.getByText('Lunch break')).toBeVisible();
});
it('unmutes inside the tap and restarts a video the browser had paused', async () => {
  const { unmount } = render(<StreamPlayer media={asMedia(new FakeMediaStream())} stream={liveStream()} label="Heat 1" />); await settle();
  const video = document.querySelector('video')!;
  play.mockClear(); vi.spyOn(video, 'paused', 'get').mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Tap for sound' }));
  expect(video.muted).toBe(false); expect(play).toHaveBeenCalledTimes(1);
  play.mockRejectedValueOnce(new Error('gesture required')); await settle(); unmount();
});
it('keeps the sound and full-screen controls in the compact public caption', async () => {
  render(<StreamPlayer media={asMedia(new FakeMediaStream())} stream={liveStream()} label="Heat 1" captionBar />); await settle();
  expect(screen.getByRole('button', { name: 'Full screen' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Tap for sound' }));
  expect(document.querySelector('video')!.muted).toBe(false);
});
it('shows announcements for eight seconds and staff messages for ten, without reviving old messages', async () => {
  const announcement = { message: chat(1, { body: 'Lunch at one' }), receivedAt: Date.now() };
  const { unmount } = render(<StreamOverlays stream={liveStream()} label="Final" reconnecting={false} muted onSound={vi.fn()} announcement={announcement} />);
  expect(screen.getByText(/Lunch at one/)).toBeVisible(); await tick(7999); expect(screen.getByText(/Lunch at one/)).toBeVisible();
  await tick(1); expect(screen.queryByText(/Lunch at one/)).toBeNull(); unmount();
  render(<StreamNotice message={chat(2, { type: 0, body: 'Finish line please' })} receivedAt={Date.now()} duration={10000} />);
  await tick(9999); expect(screen.getByText(/Finish line please/)).toBeVisible(); await tick(1); expect(screen.queryByText(/Finish line please/)).toBeNull();
  render(<StreamNotice {...announcement} />); expect(screen.queryByText(/Lunch at one/)).toBeNull();
});
it('sets autoplay properties before attaching media and mutes paused or publisher-muted video', async () => {
  const media = asMedia(new FakeMediaStream()); const properties: boolean[][] = [];
  const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, set(value) { if (value) properties.push([this.muted, this.playsInline, this.autoplay]); }, get() { return media; } });
  try {
    const { rerender, unmount } = render(<StreamPlayer media={media} stream={liveStream()} label="Heat 1" />); await settle();
    expect(properties[0]).toEqual([true, true, true]);
    fireEvent.click(screen.getByRole('button', { name: 'Tap for sound' })); await settle(); expect(document.querySelector('video')!.muted).toBe(false);
    rerender(<StreamPlayer media={media} stream={liveStream({ status: 1 })} label="Heat 1" />); await settle(); expect(document.querySelector('video')!.muted).toBe(true);
    rerender(<StreamPlayer media={media} stream={liveStream({ audioMuted: true })} label="Heat 1" />); await settle(); expect(document.querySelector('video')!.muted).toBe(true); unmount();
  } finally { if (original) Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', original); else Reflect.deleteProperty(HTMLMediaElement.prototype, 'srcObject'); }
});
it('offers Play if autoplay is blocked and retains it until playback succeeds', async () => {
  play.mockRejectedValue(new Error('gesture required'));
  render(<StreamPlayer media={asMedia(new FakeMediaStream())} stream={liveStream()} label="Final" message="Connecting…" />); await settle();
  expect(screen.getByText('Connecting…')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Play' })); await settle(); expect(screen.getByRole('button', { name: 'Play' })).toBeVisible();
  play.mockResolvedValue(); fireEvent.click(screen.getByRole('button', { name: 'Play' })); await settle(); expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
});
it('opens above chrome with native full screen and landscape, and exits on close, Escape and back', async () => {
  const push = vi.spyOn(history, 'pushState');
  const { unmount } = render(<StreamPlayer media={null} stream={liveStream()} label="Heat 1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open full screen' })); await settle();
  expect(screen.getByRole('dialog')).toHaveClass('fixed', 'inset-0', 'z-[100]', 'mg-font');
  expect(requestFullscreen).toHaveBeenCalled(); expect(lock).toHaveBeenCalledWith('landscape'); expect(push).toHaveBeenCalledOnce();
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(document.querySelector('video')!); expect(push).toHaveBeenCalledOnce();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body });
  fireEvent.click(screen.getByRole('button', { name: 'Close full screen' })); await settle(); expect(exitFullscreen).toHaveBeenCalled(); expect(unlock).toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull(); expect(history.back).toHaveBeenCalledOnce();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  fireEvent.click(document.querySelector('video')!); await settle(); fireEvent.keyDown(document, { key: 'x' }); expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.keyDown(document, { key: 'Escape' }); await settle(); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(document.querySelector('video')!); await settle(); fireEvent.popState(window); await settle(); expect(screen.queryByRole('dialog')).toBeNull();
  const backCalls = vi.mocked(history.back).mock.calls.length; fireEvent.popState(window); expect(history.back).toHaveBeenCalledTimes(backCalls);
  fireEvent.click(document.querySelector('video')!); await settle(); unmount(); expect(history.back).toHaveBeenCalledTimes(backCalls + 1); expect(document.body.style.overflow).toBe('');
});
it('exits on native full-screen exit and tolerates unavailable native APIs or refusal', async () => {
  requestFullscreen.mockRejectedValueOnce(new Error('not supported'));
  render(<StreamPlayer media={null} stream={liveStream()} label="Heat 1" />);
  fireEvent.click(document.querySelector('video')!); await settle(); expect(screen.getByRole('dialog')).toBeVisible();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body });
  fireEvent(document, new Event('fullscreenchange')); expect(screen.getByRole('dialog')).toBeVisible();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  fireEvent(document, new Event('fullscreenchange')); await settle(); expect(screen.queryByRole('dialog')).toBeNull();
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: undefined });
  Object.defineProperty(window.screen, 'orientation', { configurable: true, value: undefined });
  fireEvent.click(document.querySelector('video')!); await settle(); fireEvent.keyDown(document, { key: 'Escape' });
});
it('uses CSS full screen without native requests on iPhone', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  render(<StreamPlayer media={null} stream={liveStream()} label="Heat 1" />);
  fireEvent.click(document.querySelector('video')!); await settle(); expect(screen.getByRole('dialog')).toBeVisible(); expect(requestFullscreen).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
});
it('leaves media detached when play resolves after unmount', async () => {
  let resolve!: () => void;
  play.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
  const { unmount } = render(<StreamPlayer media={asMedia(new FakeMediaStream())} stream={liveStream()} label="Heat" />);
  const element = document.querySelector('video')!; unmount(); resolve(); await settle(); expect(element.srcObject).toBeNull();
});
it('keeps YouTube behind a tap, and other safe URLs as external links', () => {
  const { rerender } = render(<CompStreamCard streamUrl="https://youtu.be/abc" compName="Spring Games" />);
  expect(document.querySelector('iframe')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Tap to load the stream' }));
  expect(screen.getByTitle('Spring Games')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abc');
  rerender(<CompStreamCard key="twitch" streamUrl="https://twitch.tv/arena" compName="Spring Games" />);
  expect(document.querySelector('iframe')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Tap to load the stream' }));
  expect(document.querySelector('iframe')).toHaveAttribute('src', `https://player.twitch.tv/?channel=arena&parent=${window.location.hostname}`);
  rerender(<CompStreamCard key="other" streamUrl="https://example.test/arena" compName="Spring Games" />);
  expect(document.querySelector('iframe')).toBeNull(); expect(screen.getByRole('link', { name: 'Open stream' })).toHaveAttribute('href', 'https://example.test/arena');
  rerender(<CompStreamCard streamUrl="javascript:bad()" compName="Spring Games" />); expect(screen.queryByRole('link')).toBeNull();
});
const props = () => ({ competitionId: 1, streams: [liveStream()], sessions: [session(1)], ready: 1, invoke: vi.fn(async (method: string) => method === 'WatchStream' ? { watchId: 'w', generation: 1, sdpOffer: 'offer', iceServers: [] } : undefined) as StreamInvoke, messages: [], canBroadcast: true, fallback: 'https://youtu.be/abc', competitionName: 'Spring Games' });
it('hides Go live when disabled or unauthorised and shows fallback only without active streams', async () => {
  const p = props(); const { rerender } = render(<MemoryRouter><LiveVideo {...p} streams={[]} canBroadcast={false} /></MemoryRouter>);
  expect(screen.queryByRole('link', { name: 'Go live' })).toBeNull(); expect(screen.getByText('Tap to load the stream')).toBeVisible();
  rerender(<MemoryRouter><LiveVideo {...p} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Go live' })).toHaveAttribute('href', '/competitions/1/broadcast');
  expect(screen.getByText(/not supported/)).toBeVisible(); expect(screen.queryByText('Tap to load the stream')).toBeNull();
  rerender(<MemoryRouter><LiveVideo {...p} streams={[liveStream({ status: 2 })]} fallback={null} canBroadcast={false} /></MemoryRouter>);
  expect(screen.queryByRole('heading')).toBeNull(); await settle();
});
it('wires the viewer, changes cameras, passes announcements and uses captions or timetable labels', async () => {
  vi.stubGlobal('RTCPeerConnection', fakePeerConstructor); vi.stubGlobal('MediaStream', fakeStreamConstructor);
  const p = props(); const list = [liveStream({ caption: 'The final' }), liveStream({ id: 2, angleName: 'Finish line' })];
  const { rerender, unmount } = render(<MemoryRouter><LiveVideo {...p} streams={list} messages={[{ message: chat(1), receivedAt: Date.now() }]} /></MemoryRouter>); await settle();
  expect(screen.getByText('The final')).toBeVisible();
  act(() => FakePeer.instances[0].track()); await tick(2000); expect(screen.queryByText('Connecting…')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Finish line' })); await settle();
  expect(p.invoke).toHaveBeenCalledWith('StopWatching', 1); expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 2);
  expect(screen.getByText('Live from')).toBeVisible();
  rerender(<MemoryRouter><LiveVideo {...p} ready={2} streams={list.map((s) => ({ ...s, generation: 2 }))} /></MemoryRouter>); await settle();
  FakePeer.instances.at(-1)!.getStats.mockResolvedValue(new Map()); await tick(10000); expect(screen.getByText('Reconnecting…')).toBeVisible();
  unmount(); expect(p.invoke).toHaveBeenCalledWith('StopWatching', 2);
});

it('supports viewer quality switching, picture-in-picture, and instant -15s replay on StreamPlayer', async () => {
  const onQuality = vi.fn();
  const requestPip = vi.fn(async () => {});
  const exitPip = vi.fn(async () => {});
  Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', { configurable: true, value: requestPip });
  Object.defineProperty(document, 'exitPictureInPicture', { configurable: true, value: exitPip });
  Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: null });
  const media = asMedia(new FakeMediaStream());
  render(<StreamPlayer media={media} stream={liveStream()} label="Heat 1" quality="f" onQuality={onQuality} />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Quality 540p' }));
  expect(onQuality).toHaveBeenCalledWith('h');
  fireEvent.click(screen.getByRole('button', { name: 'Picture in picture' }));
  expect(requestPip).toHaveBeenCalled();
  Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: document.querySelector('video') });
  fireEvent.click(screen.getByRole('button', { name: 'Picture in picture' }));
  expect(exitPip).toHaveBeenCalled();
  Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: null });
  fireEvent.click(screen.getByRole('button', { name: 'Instant 15 second replay' }));
});

it('automatically cuts to a new camera angle on selectAngle command unless the viewer manually pinned an angle', async () => {
  vi.stubGlobal('RTCPeerConnection', fakePeerConstructor); vi.stubGlobal('MediaStream', fakeStreamConstructor);
  const p = props();
  const list = [
    liveStream({ id: 1, arenaName: 'Main Arena', angleName: 'Main camera' }),
    liveStream({ id: 2, arenaName: 'Main Arena', angleName: 'Finish line' }),
    liveStream({ id: 3, arenaName: 'Second Arena', angleName: 'Wide' }),
  ];
  const { rerender } = render(<MemoryRouter><LiveVideo {...p} streams={list} lastCommand={null} /></MemoryRouter>);
  await settle();
  expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 1);

  // Director cuts to Finish line (id: 2)
  rerender(<MemoryRouter><LiveVideo {...p} streams={list} lastCommand={{ streamId: 1, arenaName: 'Main Arena', command: 'selectAngle', value: '2', issuedAt: '2026-10-24T12:00:00Z' }} /></MemoryRouter>);
  await settle();
  expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 2);

  // Viewer manually pins Main camera (id: 1)
  vi.mocked(p.invoke).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Main camera' }));
  await settle();
  expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 1);
  expect(screen.getByRole('button', { name: 'Auto-follow director' })).toBeVisible();

  // Director cut is ignored while pinned
  vi.mocked(p.invoke).mockClear();
  rerender(<MemoryRouter><LiveVideo {...p} streams={list} lastCommand={{ streamId: 1, arenaName: 'Main Arena', command: 'selectAngle', value: '2', issuedAt: '2026-10-24T12:01:00Z' }} /></MemoryRouter>);
  await settle();
  expect(p.invoke).not.toHaveBeenCalledWith('WatchStream', 1, 2);

  // Viewer re-enables Auto-follow director or switches arena
  vi.mocked(p.invoke).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Auto-follow director' }));
  await settle();
  expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 2);

  vi.mocked(p.invoke).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Second Arena' }));
  await settle();
  expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 3);
});


function replayFixture(id: string): replayBuffers.SavedReplayClip {
  return { id, competitionId: 1, streamId: 1, arenaName: 'Main Arena', label: `Example replay ${id}`,
    createdAt: '2026-01-01T12:00:00Z', durationSeconds: 15, mimeType: 'video/webm', blob: new Blob(['example']), url: `blob:example-${id}` };
}
function replayBufferFixture(clips: replayBuffers.SavedReplayClip[] = []) {
  const buffer = { supported: true, recording: true, start: vi.fn(() => true), stop: vi.fn(), dispose: vi.fn(),
    saveClip: vi.fn<replayBuffers.ReplayBufferHandle['saveClip']>().mockResolvedValue(clips[0] ?? null),
    markRaceBookmark: vi.fn().mockResolvedValue(null), chunkCount: vi.fn(() => 1) };
  vi.spyOn(replayBuffers, 'createReplayBuffer').mockReturnValue(buffer);
  const listeners = new Set<() => void>();
  vi.spyOn(replayBuffers, 'subscribeSavedReplays').mockImplementation((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; });
  vi.spyOn(replayBuffers, 'getSavedReplays').mockImplementation(() => [...clips]);
  vi.spyOn(replayBuffers, 'loadPersistedReplays').mockResolvedValue(clips);
  vi.spyOn(replayBuffers, 'removeSavedReplay').mockImplementation((id) => { const index = clips.findIndex(c => c.id === id); if (index >= 0) clips.splice(index, 1); listeners.forEach(listener => listener()); });
  return buffer;
}

it('opens instant and saved replays, switches clips, offers a download and closes or deletes the last clip', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const clips = [replayFixture('one'), replayFixture('two')];
  const buffer = replayBufferFixture(clips);
  const { unmount } = render(<StreamPlayer media={asMedia(new FakeMediaStream())} stream={liveStream()} label="Example heat" />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Instant 15 second replay' })); await settle();
  expect(buffer.saveClip).toHaveBeenCalledWith('Example heat', expect.objectContaining({ durationSeconds: 15, signal: expect.any(AbortSignal) }));
  const dialog = screen.getByRole('dialog', { name: 'Replay inspector' });
  expect(within(dialog).getByRole('link', { name: 'Download replay' })).toHaveAttribute('href', clips[0].url);
  expect(within(dialog).getByRole('link', { name: 'Download replay' })).toHaveAttribute('download', 'Example_replay_one_Main_Arena.webm');
  fireEvent.click(within(screen.getByRole('region', { name: 'Saved clips' })).getByText('Example replay two'));
  expect(screen.getByLabelText('Example replay two video')).toHaveAttribute('src', 'blob:example-two');
  fireEvent.click(screen.getByRole('button', { name: 'Delete replay Example replay two' }));
  expect(screen.getByLabelText('Example replay one video')).toHaveAttribute('src', 'blob:example-one');
  fireEvent.click(screen.getByRole('button', { name: 'Close replay' }));
  expect(screen.queryByRole('dialog', { name: 'Replay inspector' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Saved replays/ }));
  expect(screen.getByRole('dialog', { name: 'Replay inspector' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Remove line review' }));
  expect(screen.queryByRole('dialog', { name: 'Replay inspector' })).toBeNull();
  expect(replayBuffers.removeSavedReplay).toHaveBeenLastCalledWith('one');
  unmount(); expect(buffer.dispose).toHaveBeenCalledOnce();
});

it('uses the arena fallback label, reports replay failures and disposes recordings when media changes', async () => {
  const buffer = replayBufferFixture();
  buffer.saveClip.mockRejectedValueOnce(new Error('Example storage failure'));
  const media = asMedia(new FakeMediaStream());
  const { rerender, unmount } = render(<StreamPlayer media={media} stream={liveStream()} label={null} captionBar />);
  await settle();
  expect(screen.getByText('Main Arena · Main camera')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Instant 15 second replay' })); await settle();
  expect(buffer.saveClip).toHaveBeenCalledWith('Main Arena -15s', expect.objectContaining({ durationSeconds: 15 }));
  expect(screen.getByText('Example storage failure')).toBeVisible();
  rerender(<StreamPlayer media={null} stream={liveStream()} label={null} />);
  expect(buffer.dispose).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Instant 15 second replay' })).toBeNull();
  rerender(<StreamPlayer media={media} stream={liveStream({ id: 2 })} label={null} />);
  expect(replayBuffers.createReplayBuffer).toHaveBeenLastCalledWith(expect.objectContaining({ streamId: 2 }));
  unmount(); expect(buffer.dispose).toHaveBeenCalledTimes(2);
});

it('aborts replay preparation on unmount and ignores a late clip', async () => {
  const buffer = replayBufferFixture(); const pending = deferred<replayBuffers.SavedReplayClip | null>();
  buffer.saveClip.mockReturnValueOnce(pending.promise);
  const { unmount } = render(<StreamPlayer media={asMedia(new FakeMediaStream())} stream={liveStream()} label="Example heat" />);
  fireEvent.click(screen.getByRole('button', { name: 'Instant 15 second replay' })); await settle();
  const options = buffer.saveClip.mock.calls[0][1] as replayBuffers.SaveClipOptions;
  unmount(); expect(options.signal?.aborted).toBe(true);
  pending.resolve(replayFixture('late')); await settle();
  expect(screen.queryByRole('dialog')).toBeNull(); expect(buffer.dispose).toHaveBeenCalledOnce();
});

it('falls back to Safari picture-in-picture and tolerates missing APIs and refusals', async () => {
  Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', { configurable: true, value: undefined });
  Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: null });
  const safariPip = vi.fn();
  Object.defineProperty(HTMLVideoElement.prototype, 'webkitSetPresentationMode', { configurable: true, value: safariPip });
  render(<StreamPlayer media={asMedia(new FakeMediaStream())} stream={liveStream()} label={null} />); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Picture in picture' }));
  expect(safariPip).toHaveBeenCalledWith('picture-in-picture');
  safariPip.mockImplementationOnce(() => { throw new Error('not allowed'); });
  fireEvent.click(screen.getByRole('button', { name: 'Picture in picture' }));
  Object.defineProperty(HTMLVideoElement.prototype, 'webkitSetPresentationMode', { configurable: true, value: undefined });
  fireEvent.click(screen.getByRole('button', { name: 'Picture in picture' }));
  const request = vi.fn().mockRejectedValue(new Error('not allowed'));
  Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', { configurable: true, value: request });
  fireEvent.click(screen.getByRole('button', { name: 'Picture in picture' })); await settle();
  expect(request).toHaveBeenCalledOnce();
  Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: document.querySelector('video') });
  Object.defineProperty(document, 'exitPictureInPicture', { configurable: true, value: vi.fn().mockRejectedValue(new Error('closed')) });
  fireEvent.click(screen.getByRole('button', { name: 'Picture in picture' })); await settle();
  Object.defineProperty(document, 'exitPictureInPicture', { configurable: true, value: undefined });
  fireEvent.click(screen.getByRole('button', { name: 'Picture in picture' }));
});

it('handles rejected sound gestures and ignores stale autoplay and fullscreen promises', async () => {
  const pendingPlay = deferred<void>(); play.mockReturnValueOnce(pendingPlay.promise);
  const media = asMedia(new FakeMediaStream());
  const { rerender, unmount } = render(<StreamPlayer media={media} stream={liveStream()} label={null} />);
  rerender(<StreamPlayer media={null} stream={liveStream()} label={null} />);
  pendingPlay.reject(new Error('old media')); await settle();
  expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  play.mockRejectedValueOnce(new Error('sound blocked'));
  fireEvent.click(screen.getByRole('button', { name: 'Tap for sound' })); await settle();
  expect(screen.getByRole('button', { name: 'Play' })).toBeVisible();
  const fullscreen = deferred<void>(); requestFullscreen.mockReturnValueOnce(fullscreen.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  fullscreen.resolve(); await settle();
  expect(lock).not.toHaveBeenCalled();
  unmount();
});

it('unmutes an already-playing video without restarting it and safely ignores closing an inline player', async () => {
  render(<StreamPlayer media={asMedia(new FakeMediaStream())} stream={liveStream()} label={null} />); await settle();
  const video = document.querySelector('video')!;
  vi.spyOn(video, 'paused', 'get').mockReturnValue(false); play.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Tap for sound' }));
  expect(video.muted).toBe(false); expect(play).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(history.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open full screen' })); await settle();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body });
  exitFullscreen.mockRejectedValueOnce(new Error('browser already exited'));
  fireEvent.click(screen.getByRole('button', { name: 'Close full screen' })); await settle();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('uses director stream ID without a value in the public multi-camera layout and keeps external fallback usable', async () => {
  vi.stubGlobal('RTCPeerConnection', fakePeerConstructor); vi.stubGlobal('MediaStream', fakeStreamConstructor);
  const p = props(); const streams = [liveStream(), liveStream({ id: 2, angleName: 'Finish line' })];
  const { rerender } = render(<MemoryRouter><LiveVideo {...p} publicLayout streams={streams}
    lastCommand={{ streamId: 2, arenaName: 'Main Arena', command: 'selectAngle', value: null, issuedAt: '2026-01-01T12:00:00Z' }} /></MemoryRouter>);
  await settle(); expect(p.invoke).toHaveBeenCalledWith('WatchStream', 1, 2);
  expect(screen.getByRole('button', { name: 'Finish line' })).toHaveAttribute('aria-pressed', 'true');
  rerender(<MemoryRouter><LiveVideo {...p} publicLayout streams={[]} fallback="https://example.test/live" /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Open stream' })).toHaveAttribute('href', 'https://example.test/live');
});
