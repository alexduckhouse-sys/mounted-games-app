import { expect, it } from 'vitest';
import { appendStreamMessage, streamHeatLabel, streamLink, updateStreams } from './streams';
import { liveStream } from '../test/streamFakes';
import { heat, race, session } from '../test/factories';

it('adds, sorts, updates and removes streams, ignoring older generations', () => {
  const a = liveStream(), b = liveStream({ id: 2, arenaName: 'Second' });
  expect(updateStreams([b], a)).toEqual([a, b]);
  expect(updateStreams([a], { ...a, viewerCount: 4 })).toEqual([{ ...a, viewerCount: 4 }]);
  const current = [liveStream({ generation: 2 })]; expect(updateStreams(current, a)).toBe(current);
  expect(updateStreams([a, b], { ...a, status: 2 })).toEqual([b]);
  expect(updateStreams([a], liveStream({ id: 3, angleName: 'Finish' }))[0].id).toBe(3);
});
it('uses the live heat and race for the stream arena, or null when nothing is racing there', () => {
  const sessions = [session(1, { status: 1, arenaName: ' Main Arena ', heats: [heat(1, { races: [race(2, { isComplete: true }), race(3)] })] })];
  expect(streamHeatLabel(sessions, 'Main Arena')).toBe('Seniors Session 1 · Heat 1 · Race 3');
  expect(streamHeatLabel(sessions, 'Second')).toBeNull();
  expect(streamHeatLabel([session(1, { status: 1, arenaName: 'A' })], 'A')).toBe('Seniors Session 1');
  expect(streamHeatLabel([session(1, { status: 1, arenaName: 'A', heats: [heat(1, { label: 'Final A' })] })], 'A')).toBe('Seniors Session 1 · Final A');
  expect(streamHeatLabel([session(1, { status: 1 })], 'A')).toBeNull();
});
it.each(['https://youtube.com/watch?v=abc_123-xy', 'https://www.youtube.com/embed/abc_123-xy', 'https://m.youtube.com/live/abc_123-xy', 'https://youtu.be/abc_123-xy', 'https://youtube-nocookie.com/shorts/abc_123-xy'])('allows only a no-cookie YouTube embed for %s', (raw) => {
  expect(streamLink(raw)?.embed).toBe('https://www.youtube-nocookie.com/embed/abc_123-xy');
});
it.each(['https://youtube.com/', 'https://youtube.com/watch?v=bad/id', 'https://twitch.tv/', 'https://twitch.tv/a', 'https://example.test/video', 'http://example.test'])('keeps other safe URLs as links: %s', (raw) => { expect(streamLink(raw)).toEqual({ href: new URL(raw).href, embed: null }); });
it.each(['https://twitch.tv/example_channel', 'https://m.twitch.tv/example_channel/videos'])('embeds the Twitch player for %s', (raw) => {
  expect(streamLink(raw)?.embed).toBe(`https://player.twitch.tv/?channel=example_channel&parent=${window.location.hostname}`);
});
it.each(['javascript:alert(1)', 'data:text/html,test', 'not a url'])('rejects unsafe or invalid URLs: %s', (raw) => { expect(streamLink(raw)).toBeNull(); });

it('keeps the latest announcement visible while the latest three chat messages change', () => {
  let messages = [{ message: { id: 1, type: 2 } }];
  for (const id of [2, 3, 4, 5]) messages = appendStreamMessage(messages, { message: { id, type: 0 } });
  expect(messages.map(({ message }) => message.id)).toEqual([1, 3, 4, 5]);
  expect(messages.slice(-3).map(({ message }) => message.id)).toEqual([3, 4, 5]);
  messages = appendStreamMessage(messages, { message: { id: 6, type: 2 } });
  expect(messages.map(({ message }) => message.id)).toEqual([4, 5, 6]);
  expect(appendStreamMessage([], { message: { id: 2, type: 0 } })).toHaveLength(1);
  expect(appendStreamMessage(messages, { message: { id: 6, type: 2 } })).toHaveLength(3);
});
