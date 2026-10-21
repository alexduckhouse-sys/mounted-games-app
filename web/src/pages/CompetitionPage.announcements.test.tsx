import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { chat, competition } from '../test/factories';
import { CompetitionPage } from './CompetitionPage';

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
