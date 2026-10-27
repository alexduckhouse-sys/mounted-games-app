import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competitionPhase } from '../lib/competitionPhase';
import { chat, competition, heat, session } from '../test/factories';
import { TickerProvider, useTicker } from './TickerContext';
import { TickerFeed } from './TickerFeed';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../lib/competitionPhase', () => ({ competitionPhase: vi.fn() }));

const now = new Date('2026-06-01T10:00:00Z');
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
const racing = session(1, { name: 'Seniors', sectionName: 'Teams Seniors', status: 1, scheduledStart: at(-10), startedAt: at(-10), heats: [heat(1), heat(2)] });
const detail = competition({ id: 4, sessions: [racing], sections: [] });
const notices = [chat(7, { body: 'Lunch moved to 1pm', type: 2, createdAt: at(-1) }), chat(8, { body: 'Hello all', type: 0, createdAt: at(-1) })];

function Lines() {
  const { items } = useTicker();
  return <ul aria-label="Lines">{items.map((item) => <li key={item.key}>{item.text}</li>)}</ul>;
}
function mount(competitionId = 4) {
  return render(<TickerProvider><TickerFeed competitionId={competitionId} /><Lines /></TickerProvider>);
}
const lines = () => screen.getAllByRole('listitem').map((li) => li.textContent);
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function answer(competitionData: unknown = detail, chatData: unknown = notices) {
  vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/chat') ? chatData : competitionData }));
}
const calls = () => vi.mocked(api.get).mock.calls.filter(([url]) => url === '/competitions/4').length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(now);
  vi.mocked(competitionPhase).mockReturnValue('running');
  answer();
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('TickerFeed', () => {
  it('fills the ticker with what is on and the announcements for the event, and clears it when it goes', async () => {
    const view = mount();
    await settle();
    expect(lines().some((text) => text?.includes('Lunch moved to 1pm'))).toBe(true);
    expect(lines().some((text) => text?.includes('Seniors'))).toBe(true);
    expect(lines().some((text) => text?.includes('Hello all'))).toBe(false);
    view.rerender(<TickerProvider><Lines /></TickerProvider>);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('fetches a fresh copy each minute, but not while the app is in the background', async () => {
    mount();
    await settle();
    expect(calls()).toBe(1);
    await tick(60_000);
    expect(calls()).toBe(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await tick(120_000);
    expect(calls()).toBe(2);
  });

  it('stops fetching once every final is done', async () => {
    vi.mocked(competitionPhase).mockReturnValue('complete');
    mount();
    await settle();
    await tick(180_000);
    expect(calls()).toBe(1);
  });

  it('shows nothing for an answer of the wrong shape or a failed request', async () => {
    answer({}, { not: 'a list' });
    const view = mount();
    await settle();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    view.unmount();
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    mount();
    await settle();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
