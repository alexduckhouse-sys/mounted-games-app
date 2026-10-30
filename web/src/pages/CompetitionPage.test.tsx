import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition, team, session } from '../test/factories';
import { CompetitionPage } from './CompetitionPage';
import { prefetchCompetition } from '../lib/competitionPrefetch';
import { useCompetition } from './competition/context';

const state = vi.hoisted(() => ({
  handlers: null as null | Record<string, (...args: never[]) => void>,
  connected: true,
}));

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../hooks/useCompetitionStreams', () => ({ useCompetitionStreams: () => ({ streams: [], streamingEnabled: false, onStreamUpdated: vi.fn(), onStreamViewers: vi.fn() }) }));
vi.mock('../live/useLiveHub', () => ({
  useLiveHub: (_id: number, handlers: Record<string, (...args: never[]) => void>) => {
    state.handlers = handlers;
    return { connected: state.connected, invoke: vi.fn(), reconnect: vi.fn() };
  },
}));
vi.mock('../live/ConnectionStatusContext', () => ({ useConnectionStatus: () => ({ setStatus: vi.fn() }) }));
vi.mock('../components/TickerContext', () => ({ useTicker: () => ({ setItems: vi.fn(), setWatchCompetitionId: vi.fn() }) }));
vi.mock('../competition/CurrentCompetitionContext', () => ({ useCurrentCompetition: () => ({ setCurrent: vi.fn(), setVenue: vi.fn() }) }));
vi.mock('../components/NavExtrasContext', () => ({ useNavExtras: () => ({ setExtras: vi.fn(), clear: vi.fn() }) }));
vi.mock('../components/AgeGroupsContext', () => ({ useAgeGroups: () => ({ setGroups: vi.fn() }) }));
vi.mock('../components/competitionMeta', () => ({ useCompetitionMeta: () => ({ setMeta: vi.fn() }) }));
vi.mock('../components/ScoreOutboxPanel', () => ({ ScoreOutboxPanel: () => null }));
vi.mock('../components/WeatherAlert', () => ({ WeatherAlert: () => null }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.get).mockReset();
  state.handlers = null;
  state.connected = true;
});

describe('CompetitionPage initial onReady race prevention', () => {
  it('does not abort the in-flight initial GET /competitions/:id when the first onReady fires, and reloads on subsequent reconnects', async () => {
    let resolveComp!: (value: { data: unknown; headers: object }) => void;
    const compSignals: AbortSignal[] = [];

    vi.mocked(api.get).mockImplementation(((url: string, config?: { signal?: AbortSignal }) => {
      if (url === '/competitions/1') {
        if (config?.signal) compSignals.push(config.signal);
        return new Promise<{ data: unknown; headers: object }>((resolve) => { resolveComp = resolve; });
      }
      if (url.endsWith('/first-view')) return new Promise(() => {});
      return Promise.resolve({ data: [], headers: {} });
    }) as typeof api.get);

    render(
      <MemoryRouter initialEntries={['/competitions/1']}>
        <Routes>
          <Route path="/competitions/:id/*" element={<CompetitionPage />}>
            <Route path="*" element={<p>Competition loaded</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(compSignals).toHaveLength(1);
    expect(compSignals[0].aborted).toBe(false);

    // First onReady right after mount while initial GET /competitions/1 is still in flight:
    act(() => state.handlers?.onReady?.());
    expect(compSignals).toHaveLength(1);
    expect(compSignals[0].aborted).toBe(false);

    await act(async () => {
      resolveComp({ data: competition({ name: 'Spring Championship' }), headers: {} });
    });
    expect(await screen.findByText('Competition loaded')).toBeVisible();

    // Second onReady (recovering from a later disconnect) reloads the competition:
    act(() => state.handlers?.onReady?.());
    await waitFor(() => expect(compSignals).toHaveLength(2));
  });

  it('reloads on the first onReady if the initial GET /competitions/:id failed before the hub connected', async () => {
    let calls = 0;
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/competitions/1') {
        calls += 1;
        if (calls === 1) throw new Error('network blip');
        return { data: competition({ name: 'Recovered Competition' }), headers: {} };
      }
      if (url.endsWith('/first-view')) throw new Error('offline');
      return { data: [], headers: {} };
    });

    render(
      <MemoryRouter initialEntries={['/competitions/1']}>
        <Routes>
          <Route path="/competitions/:id/*" element={<CompetitionPage />}>
            <Route path="*" element={<p>Competition loaded</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(calls).toBe(1);

    // First onReady arrives after the initial fetch failed -> triggers reload!
    act(() => state.handlers?.onReady?.());
    expect(await screen.findByText('Competition loaded')).toBeVisible();
    expect(calls).toBe(2);
  });
});

function DetailProbe() {
  const { competition: detail } = useCompetition();
  return <><p>{detail.name}</p><p>{detail.teams[0]?.refereeCard ?? "no card"}</p></>;
}
function mountDetail() {
  return render(<MemoryRouter initialEntries={['/competitions/1']}><Routes>
    <Route path="/competitions/:id/*" element={<CompetitionPage />}><Route path="*" element={<DetailProbe />} /></Route>
  </Routes></MemoryRouter>);
}

it('adopts a pending full-detail hover request while keeping the small first-view request separate', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === '/competitions/1') return new Promise<unknown>((resolve) => { finish = resolve; });
    if (url.endsWith('/first-view')) return new Promise(() => {});
    return Promise.resolve({ data: [], headers: {} });
  }) as typeof api.get);
  const warm = prefetchCompetition(1);
  mountDetail();
  expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/competitions/1')).toHaveLength(1);
  expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/competitions/1/first-view')).toBe(true);
  await act(async () => { finish({ data: competition({ name: 'Fake prefetched event' }), headers: {} }); await warm; });
  expect(await screen.findByText('Fake prefetched event')).toBeVisible();
});

it('opens first-view and full detail during repeated live updates and keeps those updates', async () => {
  let finish!: (value: unknown) => void;
  let firstView!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === '/competitions/1') return new Promise<unknown>((resolve) => { finish = resolve; });
    if (url.endsWith('/first-view')) return new Promise<unknown>((resolve) => { firstView = resolve; });
    return Promise.resolve({ data: [], headers: {} });
  }) as typeof api.get);
  mountDetail();
  act(() => state.handlers?.onResultsUpdated?.({ teamId: 7, refereeCard: 'yellow' } as never));
  await act(async () => firstView({ data: competition({ name: 'Fake first view', teams: [team(7)] }), headers: {} }));
  expect(screen.getByText('Fake first view')).toBeVisible();
  expect(screen.getByText('yellow')).toBeVisible();
  act(() => state.handlers?.onResultsUpdated?.({ teamId: 7, refereeCard: 'red' } as never));
  await act(async () => finish({ data: competition({ name: 'Fake full event', teams: [team(7)] }), headers: {} }));
  expect(screen.getByText('Fake full event')).toBeVisible();
  expect(screen.getByText('red')).toBeVisible();
  expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/competitions/1')).toHaveLength(1);
});


it('finishes the active prefetch during session traffic, preserves patches and queues one fresh reconciliation', async () => {
  let finish!: (value: unknown) => void;
  const signals: AbortSignal[] = [];
  vi.mocked(api.get).mockImplementation(((url: string, options?: { signal?: AbortSignal }) => {
    if (url === '/competitions/1') {
      if (options?.signal) signals.push(options.signal);
      return new Promise<unknown>((resolve) => { if (!options?.signal) finish = resolve; });
    }
    if (url.endsWith('/first-view')) return new Promise(() => {});
    return Promise.resolve({ data: [], headers: {} });
  }) as typeof api.get);
  const warm = prefetchCompetition(1);
  mountDetail();
  act(() => {
    state.handlers?.onResultsUpdated?.({ teamId: 7, refereeCard: 'red' } as never);
    state.handlers?.onSessionUpdated?.(session(4) as never);
    state.handlers?.onSessionUpdated?.(session(5) as never);
  });
  expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/competitions/1')).toHaveLength(1);
  await act(async () => { finish({ data: competition({ name: 'Fake loaded snapshot', teams: [team(7)] }), headers: {} }); await warm; });
  expect(screen.getByText('Fake loaded snapshot')).toBeVisible();
  expect(screen.getByText('red')).toBeVisible();
  expect(signals).toHaveLength(1);
  act(() => state.handlers?.onSessionUpdated?.(session(6) as never));
  expect(signals[0].aborted).toBe(false);
  expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/competitions/1')).toHaveLength(2);
});

describe('CompetitionPage reload', () => {
  it('tells the refresh button whether the event changed, came from the saved copy or failed', async () => {
    const answers: Array<() => Promise<{ data: unknown; headers: object }>> = [];
    const base = competition({ id: 1, name: 'Spring Championship' });
    vi.mocked(api.get).mockImplementation(((url: string) => {
      if (url === '/competitions/1') return (answers.shift() ?? (() => Promise.resolve({ data: base, headers: {} })))();
      if (url.endsWith('/first-view')) return new Promise(() => {});
      return Promise.resolve({ data: [], headers: {} });
    }) as typeof api.get);
    const page: { reload?: ReturnType<typeof useCompetition>['reload'] } = {};
    function Probe() {
      const { reload, competition: shown } = useCompetition();
      useEffect(() => { page.reload = reload; });
      return <p>{shown.name}</p>;
    }
    render(
      <MemoryRouter initialEntries={['/competitions/1']}>
        <Routes>
          <Route path="/competitions/:id/*" element={<CompetitionPage />}>
            <Route path="*" element={<Probe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Spring Championship')).toBeVisible();

    // Refresh the way the header does: the tap starts a load, and the answer settles once that load is in.
    const refresh = async () => {
      let answer!: ReturnType<NonNullable<typeof page.reload>>;
      act(() => { answer = page.reload!(); });
      let outcome: unknown;
      await act(async () => { outcome = await answer; });
      return outcome;
    };
    let outcome = await refresh();
    expect(outcome).toBe('same');

    answers.push(() => Promise.resolve({ data: { ...base, name: 'Spring Finals' }, headers: {} }));
    outcome = await refresh();
    expect(outcome).toBe('updated');
    expect(await screen.findByText('Spring Finals')).toBeVisible();

    answers.push(() => Promise.resolve({ data: base, headers: { 'x-mg-saved-copy': '1', 'x-mg-saved-at': '2026-01-01T00:00:00Z' } }));
    outcome = await refresh();
    expect(outcome).toBe('offline');

    answers.push(() => Promise.reject(new Error('500')));
    outcome = await refresh();
    expect(outcome).toBe('failed');
  });
});
