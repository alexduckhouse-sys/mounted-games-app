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
}));

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../hooks/useCompetitionStreams', () => ({ useCompetitionStreams: () => ({ streams: [], streamingEnabled: false, onStreamUpdated: vi.fn(), onStreamViewers: vi.fn() }) }));
vi.mock('../live/useLiveHub', () => ({ useLiveHub: (_id: number, handlers: Record<string, (...args: never[]) => void>) => { state.handlers = handlers; return { connected: true, invoke: state.invoke }; } }));
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
