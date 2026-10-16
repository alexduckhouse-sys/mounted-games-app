import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StreamChips } from './StreamChips';
import { StreamNotice, StreamOverlays } from './StreamOverlays';
import { StreamPlayer } from './StreamPlayer';
import { CompStreamCard, LiveVideo } from './LiveVideo';
import { chat, session } from '../../test/factories';
import { asMedia, FakeMediaStream, FakePeer, fakePeerConstructor, fakeStreamConstructor, flush, liveStream, resetMedia } from '../../test/streamFakes';
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
  rerender(<CompStreamCard streamUrl="https://twitch.tv/arena" compName="Spring Games" />);
  expect(document.querySelector('iframe')).toBeNull(); expect(screen.getByRole('link', { name: 'Open stream' })).toHaveAttribute('href', 'https://twitch.tv/arena');
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
  expect(screen.getByText('Main Arena')).toBeVisible();
  rerender(<MemoryRouter><LiveVideo {...p} ready={2} streams={list.map((s) => ({ ...s, generation: 2 }))} /></MemoryRouter>); await settle();
  FakePeer.instances.at(-1)!.getStats.mockResolvedValue(new Map()); await tick(10000); expect(screen.getByText('Reconnecting…')).toBeVisible();
  unmount(); expect(p.invoke).toHaveBeenCalledWith('StopWatching', 2);
});
