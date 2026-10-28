import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { CompactPageBarProvider } from '../../components/CompactPageBarContext';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { setActiveLang, type Lang } from '../../i18n/translate';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import { autoConfirm } from '../../test/confirm';
import type { ArenaCrewPropSheet } from '../../types';
import { resetRaceTemplates } from '../../lib/raceTemplates';
import { ArenaCrewPage } from './ArenaCrewPage';
import { ArenaHelpSheet } from './ArenaHelpSheet';
import { CommentaryDeskPage } from './CommentaryDeskPage';
import { CommentatorBriefingCard } from './CommentatorBriefingCard';
import { CompetitionContext, type CompetitionCtx } from './context';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canManage: () => false, canOrganise: () => false }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../live/useLiveHub', () => ({ useLiveHub: () => ({ connected: true }) }));

const h = heat(10, {
  sessionId: 1,
  label: 'Heat 1',
  orderIndex: 1,
  entries: [
    { id: 1, teamId: 1, teamName: 'North A', bibColour: 'Red', laneIndex: 1 },
    { id: 2, teamId: 2, teamName: 'South B', bibColour: 'Blue', laneIndex: 2 },
  ],
  races: [
    race(100, { heatId: 10, name: 'Bending', orderIndex: 1, isComplete: true, results: [result(1, 1, { teamName: 'North A', points: 2 }), result(2, 2, { teamName: 'South B', points: 1 })] }),
    race(101, { heatId: 10, name: 'Mug', orderIndex: 2, isComplete: false, results: [] }),
  ],
});
const s = session(1, { name: 'Session 1', arenaName: 'Main Arena', status: 1, competitionSectionId: 9, heats: [h] });
const comp = () => competition({
  id: 1,
  name: 'Spring',
  sections: [{ id: 9, competitionId: 1, format: 2, ageGroup: 'U17', displayName: 'Under 17', finalistCount: 2 }],
  teams: [team(1, { competitionSectionId: 9, displayName: 'North A' }), team(2, { competitionSectionId: 9, displayName: 'South B' })],
  sessions: [s],
});

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width'), media: query, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => setActiveLang('en'));

describe.each([
  ['fr' as Lang, { desk: 'Pupitre de commentaire', sideBySide: 'Côte à côte', upNext: 'À suivre', english: 'Side-by-Side' }],
  ['cy' as Lang, { desk: 'Desg sylwebu', sideBySide: 'Ochr yn ochr', upNext: 'Nesaf', english: 'Side-by-Side' }],
])('commentary desk in %s', (lang, words) => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.endsWith('/standings')) return Promise.resolve({ data: [standing(1, 2, { teamName: 'North A' }), standing(2, 1, { teamName: 'South B' })] });
      return Promise.resolve({ data: [] });
    });
  });

  it('translates the desk', async () => {
    const ctx = { competition: comp(), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [], sponsors: [], saveOverlay: vi.fn() } as unknown as CompetitionCtx;
    render(
      <LanguageProvider initial={lang}>
        <MemoryRouter initialEntries={['/competitions/1/commentary']}>
          <CompactPageBarProvider>
            <CompetitionContext.Provider value={ctx}>
              <Routes><Route path="/competitions/:id/commentary" element={<CommentaryDeskPage />} /></Routes>
            </CompetitionContext.Provider>
          </CompactPageBarProvider>
        </MemoryRouter>
      </LanguageProvider>,
    );
    expect(await screen.findByText(new RegExp(words.desk))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: words.sideBySide })).toBeInTheDocument();
    expect(screen.getAllByText(words.upNext).length).toBeGreaterThan(0);
    expect(screen.queryByText(words.english)).toBeNull();
    expect(screen.queryByText('Up next')).toBeNull();
  });

  it('translates the briefing card', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: {} });
    render(
      <LanguageProvider initial={lang}>
        <CommentatorBriefingCard
          competitionId={1} session={s} heat={h} allSessions={[s]} standings={[standing(1, 2, { teamName: 'North A' })]}
          teams={comp().teams} declarations={[]} refreshTick={0}
          laneOrder={[{ teamId: 1, lane: '1', sitting: false }, { teamId: 2, lane: '2', sitting: true }]}
        />
      </LanguageProvider>,
    );
    const lane = lang === 'fr' ? 'Couloir 1' : 'Lôn 1';
    const sits = lang === 'fr' ? 'Au repos' : 'Yn eistedd allan';
    expect(await screen.findByText(lane)).toBeInTheDocument();
    expect(screen.getByText(sits)).toBeInTheDocument();
    expect(screen.queryByText('Lane 1')).toBeNull();
    expect(screen.queryByText('Sits out')).toBeNull();
  });
});

describe('arena help sheet in French', () => {
  it('asks in French before calling', async () => {
    const asked = autoConfirm(false);
    render(<LanguageProvider initial="fr"><ArenaHelpSheet competitionId={5} sessionId={7} arenaName="Arena 1" onClose={vi.fn()} /></LanguageProvider>);
    expect(screen.getByText('Appeler à l’aide')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Appeler : vétérinaire' }));
    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(asked.mock.calls[0][0]).toContain('met l’arène en pause');
    expect(screen.queryByText('Call for help')).toBeNull();
  });
});

describe('arena crew page in Welsh', () => {
  it('translates the sheet', async () => {
    resetRaceTemplates();
    const sheet: ArenaCrewPropSheet = {
      competitionId: 1, lanesPerHeat: 5, allHeatRaces: [],
      currentRace: { raceName: 'Bending', orderIndex: 1, bendingPolesPerLane: 5, zones: [{ zoneKey: 'start', zoneLabel: 'Start', items: [], summaryText: '' }] },
      nextRace: { raceName: 'Mugs', orderIndex: 2, bendingPolesPerLane: 0, zones: [] },
      transition: { bringIn: [], clearOut: [], keepInRing: [], summaryText: '' },
    };
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: sheet });
    const ctx = { competition: comp(), reload: vi.fn() } as unknown as CompetitionCtx;
    render(
      <LanguageProvider initial="cy">
        <MemoryRouter>
          <CompactPageBarProvider>
            <CompetitionContext.Provider value={ctx}><ArenaCrewPage /></CompetitionContext.Provider>
          </CompactPageBarProvider>
        </MemoryRouter>
      </LanguageProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Y ras nesaf: Mugs' })).toBeInTheDocument();
    expect(screen.getAllByText('Dim byd').length).toBeGreaterThan(0);
    expect(screen.queryByText('Nothing')).toBeNull();
  });
});
