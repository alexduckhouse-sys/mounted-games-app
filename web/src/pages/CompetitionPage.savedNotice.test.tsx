import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition } from '../test/factories';
import { CompetitionPage } from './CompetitionPage';
import { savedCopyKeys, writeSavedCopy } from '../offline/savedCopies';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../hooks/useCompetitionStreams', () => ({ useCompetitionStreams: () => ({ streams: [], streamingEnabled: false, onStreamUpdated: vi.fn(), onStreamViewers: vi.fn() }) }));
vi.mock('../live/useLiveHub', () => ({ useLiveHub: () => ({ connected: true, invoke: vi.fn(), reconnect: vi.fn() }) }));
vi.mock('../live/ConnectionStatusContext', () => ({ useConnectionStatus: () => ({ setStatus: vi.fn() }) }));
vi.mock('../components/TickerContext', () => ({ useTicker: () => ({ setItems: vi.fn(), setWatchCompetitionId: vi.fn() }) }));
vi.mock('../competition/CurrentCompetitionContext', () => ({ useCurrentCompetition: () => ({ setCurrent: vi.fn(), setVenue: vi.fn() }) }));
vi.mock('../components/NavExtrasContext', () => ({ useNavExtras: () => ({ setExtras: vi.fn(), clear: vi.fn() }) }));
vi.mock('../components/AgeGroupsContext', () => ({ useAgeGroups: () => ({ setGroups: vi.fn() }) }));
vi.mock('../components/competitionMeta', () => ({ useCompetitionMeta: () => ({ setMeta: vi.fn() }) }));
vi.mock('../components/ScoreOutboxPanel', () => ({ ScoreOutboxPanel: () => null }));
vi.mock('../components/WeatherAlert', () => ({ WeatherAlert: () => null }));

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const renderPage = () => render(
  <MemoryRouter initialEntries={['/competitions/1']}>
    <Routes><Route path="/competitions/:id/*" element={<CompetitionPage />}><Route path="*" element={<p>Competition loaded</p>} /></Route></Routes>
  </MemoryRouter>,
);
const swCopy = (minutes: number | null) => ({ 'x-mg-saved-copy': '1', ...(minutes === null ? {} : { 'x-mg-saved-at': minutesAgo(minutes).toISOString() }) });
const answer = (headers: object) => vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/chat') ? { data: [] } : { data: competition(), headers });
const offline = () => vi.mocked(api.get).mockImplementation(async (url: string) => { if (url.endsWith('/chat')) return { data: [] }; throw new Error('offline'); });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.mocked(api.get).mockReset(); });

describe('CompetitionPage: saved copy notice', () => {
  it('says nothing on a normal load', async () => {
    answer({});
    renderPage();
    expect(await screen.findByText('Competition loaded')).toBeVisible();
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
  });

  it('says nothing for an offline copy that is only a few minutes old', async () => {
    answer(swCopy(3));
    renderPage();
    expect(await screen.findByText('Competition loaded')).toBeVisible();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
  });

  it('says nothing when a recently saved copy fails to refresh', async () => {
    writeSavedCopy(savedCopyKeys.competition(1), competition(), minutesAgo(2));
    offline();
    renderPage();
    expect(await screen.findByText('Competition loaded')).toBeVisible();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
  });

  it('says when the copy is old and the refresh failed, and the button tries again', async () => {
    writeSavedCopy(savedCopyKeys.competition(1), competition(), minutesAgo(60));
    offline();
    renderPage();
    expect(await screen.findByText(/Last updated \d\d:\d\d\. We’ll refresh when you’re back online\./)).toBeVisible();
    answer({});
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument());
  });

  it('says when an offline copy from the service worker is old', async () => {
    answer(swCopy(45));
    renderPage();
    expect(await screen.findByText(/Last updated .*We’ll refresh/)).toBeVisible();
  });

  it('counts an offline copy with no readable time as old', async () => {
    answer(swCopy(null));
    renderPage();
    expect(await screen.findByText('Last updated earlier. We’ll refresh when you’re back online.')).toBeVisible();
  });
});
