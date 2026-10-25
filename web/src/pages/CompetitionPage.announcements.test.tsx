import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { chat, competition, session } from '../test/factories';
import { CompetitionPage } from './CompetitionPage';
import { useCompetition } from './competition/context';
import { readSavedCopy, savedCopyKeys, writeSavedCopy } from '../offline/savedCopies';

const state = vi.hoisted(() => ({
  handlers: null as null | Record<string, (...args: never[]) => void>,
  setItems: vi.fn(),
  setWatchCompetitionId: vi.fn(),
  setCurrent: vi.fn(),
  setVenue: vi.fn(),
  setMeta: vi.fn(),
  setGroups: vi.fn(),
  setExtras: vi.fn(),
  clearExtras: vi.fn(),
  invoke: vi.fn(),
  reconnect: vi.fn(),
  setStatus: vi.fn(),
  connected: true,
}));

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../hooks/useCompetitionStreams', () => ({ useCompetitionStreams: () => ({ streams: [], streamingEnabled: false, onStreamUpdated: vi.fn(), onStreamViewers: vi.fn() }) }));
vi.mock('../live/useLiveHub', () => ({ useLiveHub: (_id: number, handlers: Record<string, (...args: never[]) => void>) => { state.handlers = handlers; return { connected: state.connected, invoke: state.invoke, reconnect: state.reconnect }; } }));
vi.mock('../live/ConnectionStatusContext', () => ({ useConnectionStatus: () => ({ setStatus: state.setStatus }) }));
vi.mock('../components/TickerContext', () => ({ useTicker: () => ({ setItems: state.setItems, setWatchCompetitionId: state.setWatchCompetitionId }) }));
vi.mock('../competition/CurrentCompetitionContext', () => ({ useCurrentCompetition: () => ({ setCurrent: state.setCurrent, setVenue: state.setVenue }) }));
vi.mock('../components/NavExtrasContext', () => ({ useNavExtras: () => ({ setExtras: state.setExtras, clear: state.clearExtras }) }));
vi.mock('../components/AgeGroupsContext', () => ({ useAgeGroups: () => ({ setGroups: state.setGroups }) }));
vi.mock('../components/competitionMeta', () => ({ useCompetitionMeta: () => ({ setMeta: state.setMeta }) }));
vi.mock('../components/ScoreOutboxPanel', () => ({ ScoreOutboxPanel: () => null }));

const latestTickerText = () => (state.setItems.mock.calls.at(-1)?.[0] as Array<{ text: string }> | undefined)?.map((item) => item.text) ?? [];

beforeEach(() => {
  Object.values(state).forEach((value) => { if (typeof value === 'function' && 'mockClear' in value) value.mockClear(); });
  state.handlers = null;
  state.connected = true;
  const oldBanner = chat(1, { body: 'Old pinned notice', tag: 'banner', createdAt: '2020-01-01T10:00:00Z' });
  vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/chat')
    ? { data: [oldBanner] }
    : { data: competition(), headers: {} });
});

it('keeps the active banner in the ticker, replaces it and removes it on the delete event', async () => {
  render(<MemoryRouter initialEntries={['/competitions/1']}><Routes><Route path="/competitions/:id" element={<CompetitionPage />}><Route index element={<p>Competition loaded</p>} /></Route></Routes></MemoryRouter>);
  expect(await screen.findByText('Competition loaded')).toBeVisible();
  await waitFor(() => expect(latestTickerText()).toContain('Old pinned notice'));

  const replacement = chat(2, { body: 'New pinned notice', tag: 'banner', createdAt: '2020-01-01T11:00:00Z' });
  act(() => state.handlers?.onAnnouncement(replacement as never));
  await waitFor(() => {
    expect(latestTickerText()).toContain('New pinned notice');
    expect(latestTickerText()).not.toContain('Old pinned notice');
  });

  act(() => state.handlers?.onChatMessageDeleted({ id: 2 } as never));
  await waitFor(() => expect(latestTickerText()).not.toContain('New pinned notice'));
});

describe('announcement pop-up', () => {
  const pop = () => document.querySelector('.mg-announce-pop');

  it('pops up a live announcement on other tabs and goes when the announcement is deleted', async () => {
    renderAt('/competitions/1');
    expect(await screen.findByText('Competition loaded')).toBeVisible();
    act(() => state.handlers?.onAnnouncement(chat(7, { type: 2, body: 'Arena 2 is closed' }) as never));
    await waitFor(() => expect(pop()).toHaveTextContent('Arena 2 is closed'));
    expect(pop()!.querySelector('a')).toHaveAttribute('href', '/competitions/1/chat');
    act(() => state.handlers?.onChatMessageDeleted({ id: 7 } as never));
    await waitFor(() => expect(pop()).toBeNull());
  });

  it('stays quiet on the Live tab, where the announcement lands in the feed', async () => {
    renderAt('/competitions/1/chat');
    expect(await screen.findByText('Competition loaded')).toBeVisible();
    act(() => state.handlers?.onAnnouncement(chat(8, { type: 2, body: 'Lunch until 1pm' }) as never));
    expect(pop()).toBeNull();
  });
});

type Published = { connected: boolean; failures: number; intervalMs: number; retrying: boolean; retry: () => void } | null;
const lastStatus = () => state.setStatus.mock.calls.at(-1)?.[0] as Published;
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/competitions/:id/*" element={<CompetitionPage />}><Route path="*" element={<p>Competition loaded</p>} /></Route></Routes></MemoryRouter>);

it('tells the header pill how the connection is doing and clears it on leaving', async () => {
  const { unmount } = renderAt('/competitions/1');
  expect(await screen.findByText('Competition loaded')).toBeVisible();
  await waitFor(() => expect(lastStatus()).toMatchObject({ connected: true, failures: 0, intervalMs: 30_000, retrying: false }));
  unmount();
  expect(lastStatus()).toBeNull();
});

it('checks every 15 s on a heat page and counts failed checks while the live link is down', async () => {
  state.connected = false;
  renderAt('/competitions/1/session/3');
  expect(await screen.findByText('Competition loaded')).toBeVisible();
  await waitFor(() => expect(lastStatus()).toMatchObject({ connected: false, failures: 0, intervalMs: 15_000 }));

  vi.mocked(api.get).mockRejectedValue(new Error('no signal'));
  act(() => lastStatus()!.retry());
  expect(state.reconnect).toHaveBeenCalledOnce();
  await waitFor(() => expect(lastStatus()).toMatchObject({ failures: 1, retrying: false }));
});

it('counts a saved copy from the service worker as a failed check', async () => {
  vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/chat')
    ? { data: [] }
    : { data: competition(), headers: { 'x-mg-saved-copy': '1', 'x-mg-saved-at': '2026-10-21T10:00:00.000Z' } });
  renderAt('/competitions/1');
  expect(await screen.findByText('Competition loaded')).toBeVisible();
  await waitFor(() => expect(lastStatus()).toMatchObject({ failures: 1 }));
});

describe('first view', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  it('shows the small first view until the full timetable arrives, and never saves it', async () => {
    const full = deferred<{ data: unknown; headers: object }>();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/chat')) return { data: [] };
      if (url.endsWith('/first-view')) return { data: competition({ name: 'Partial view' }), headers: {} };
      return full.promise;
    });
    renderAt('/competitions/1');

    expect(await screen.findByText('Loading the rest of the timetable…')).toBeVisible();
    await waitFor(() => expect(state.setCurrent).toHaveBeenCalledWith(expect.objectContaining({ name: 'Partial view' })));
    await new Promise((done) => setTimeout(done, 600));
    expect(readSavedCopy(savedCopyKeys.competition(1))).toBeNull();

    await act(async () => { full.resolve({ data: competition({ name: 'Full timetable' }), headers: {} }); });
    await waitFor(() => expect(screen.queryByText('Loading the rest of the timetable…')).toBeNull());
    expect(state.setCurrent).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Full timetable' }));
  });

  it('ignores a first view that arrives after the full timetable', async () => {
    const first = deferred<{ data: unknown; headers: object }>();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/chat')) return { data: [] };
      if (url.endsWith('/first-view')) return first.promise;
      return { data: competition({ name: 'Full timetable' }), headers: {} };
    });
    renderAt('/competitions/1');
    expect(await screen.findByText('Competition loaded')).toBeVisible();

    await act(async () => { first.resolve({ data: competition({ name: 'Partial view' }), headers: {} }); });
    expect(screen.queryByText('Loading the rest of the timetable…')).toBeNull();
    expect(state.setCurrent).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'Partial view' }));
  });

  it('skips the first view when this phone already has a saved copy', async () => {
    writeSavedCopy(savedCopyKeys.competition(1), competition(), new Date());
    renderAt('/competitions/1');
    expect(await screen.findByText('Competition loaded')).toBeVisible();
    expect(vi.mocked(api.get).mock.calls.map(([url]) => url)).not.toContain('/competitions/1/first-view');
  });
});

describe('score cards', () => {
  function Cards() {
    const { scoreCards } = useCompetition();
    return <p>{(scoreCards ?? []).map((c) => `${c.heading} / ${c.card.raceName}`).join('|') || 'No cards'}</p>;
  }
  const entries = [{ id: 1, teamId: 1, teamName: 'England', laneIndex: 0 }, { id: 2, teamId: 2, teamName: 'Wales', laneIndex: 1 }];
  const raceOf = (scored: boolean) => ({ id: 7, heatId: 5, name: 'Bottle Race', orderIndex: 1, isComplete: scored,
    results: scored ? [{ id: 1, teamId: 1, teamName: 'England', placing: 1, eliminated: false, points: 2 }, { id: 2, teamId: 2, teamName: 'Wales', placing: 2, eliminated: false, points: 1 }] : [] });
  const heatOf = (scored: boolean) => ({ id: 5, sessionId: 1, orderIndex: 1, entries, races: [raceOf(scored)] });

  it('queues a card when live results score a race', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/chat')
      ? { data: [] }
      : { data: competition({ sessions: [session(1, { arenaName: 'Arena 1', sectionName: 'Seniors', name: 'Seniors', heats: [heatOf(false)] })] }), headers: {} });
    render(<MemoryRouter initialEntries={['/competitions/1']}><Routes><Route path="/competitions/:id" element={<CompetitionPage />}><Route index element={<Cards />} /></Route></Routes></MemoryRouter>);
    expect(await screen.findByText('No cards')).toBeVisible();

    act(() => state.handlers?.onResultsUpdated({ sessionId: 1, heat: heatOf(true) } as never));
    // The whole competition page renders here, which can take over a second on a busy CI runner.
    expect(await screen.findByText(/Heat 1 \/ Bottle Race$/, undefined, { timeout: 4000 })).toBeVisible();

    act(() => state.handlers?.onResultsUpdated({ sessionId: 1, raceId: 7, started: null } as never));
    expect(screen.getByText(/Bottle Race$/).textContent?.split('|')).toHaveLength(1);

    act(() => state.handlers?.onScoreCardControl('nonsense' as never));
    expect(screen.getByText(/Bottle Race$/)).toBeVisible();
    act(() => state.handlers?.onScoreCardControl({ heatId: 5, raceId: 7, action: 'skip' } as never));
    expect(await screen.findByText('No cards', undefined, { timeout: 4000 })).toBeVisible();
  });
});

it('shows no demo event banner, even on a demo competition', async () => {
  vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/chat')
    ? { data: [] }
    : { data: competition({ isDemo: true }), headers: {} });
  renderAt('/competitions/1');
  expect(await screen.findByText('Competition loaded')).toBeVisible();
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
  expect(screen.queryByText('Demo event')).not.toBeInTheDocument();
});
