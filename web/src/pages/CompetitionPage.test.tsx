import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition } from '../test/factories';
import { CompetitionPage } from './CompetitionPage';

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
