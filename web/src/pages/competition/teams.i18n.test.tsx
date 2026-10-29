import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { FAVOURITES_KEY } from '../../lib/favourites';
import type { TeamDetail } from '../../lib/toplist';
import { competition, heat, race, result, session, team } from '../../test/factories';
import { CompetitionContext, type CompetitionCtx } from './context';
import { FollowingTab } from './FollowingTab';
import { TeamSheet } from './TeamSheet';
import { FollowingPage } from '../FollowingPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const data = competition({ teams: [team(1, { displayName: 'Example Blue' }), team(2, { displayName: 'Example Red' })], sessions: [
  session(1, { status: 1, heats: [heat(1, { entries: [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }], races: [
    race(1, { isComplete: true, results: [result(1, 1, { points: 4 })] }), race(2),
  ] })] }),
] });

function mountFollowing(lang: Lang) {
  const ctx: CompetitionCtx = { competition: data, reload: vi.fn(), updatedAt: new Date('2026-07-01T10:00:00Z'), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [] };
  return render(
    <LanguageProvider initial={lang}>
      <MemoryRouter initialEntries={['/competitions/1/following']}>
        <CompetitionContext.Provider value={ctx}>
          <Routes><Route path="/competitions/:id"><Route path="following" element={<FollowingTab />} /></Route></Routes>
        </CompetitionContext.Provider>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('Following tab in Welsh and French', () => {
  beforeEach(() => { vi.mocked(api.get).mockRejectedValue(new Error('offline')); });

  it('speaks Welsh but leaves team names as they were typed', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1},{"competitionId":1,"teamId":2}]');
    mountFollowing('cy');
    const now = screen.getByRole('heading', { name: 'Ar y gweill' }).closest('section')!;
    expect(within(now).getByText('Example Blue')).toBeInTheDocument();
    expect(within(now).getByText('AR Y GWEILL')).toBeInTheDocument();
    expect(within(now).getByText('Seniors Rhagras 1 · ras 2 o 2')).toBeInTheDocument();
    expect(within(now).getByText('lôn 2 · 1af hyd yma, 4 pwynt')).toBeInTheDocument();
    expect(within(now).getByText('1 tîm')).toBeInTheDocument();
    const next = screen.getByRole('heading', { name: 'Nesaf' }).closest('section')!;
    expect(within(next).getByText('Heb ei dynnu eto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dad-ddilyn Example Blue' })).toBeInTheDocument();
    expect(screen.queryByText('On now')).not.toBeInTheDocument();
  });

  it('speaks French, with plural forms from the French rules', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    mountFollowing('fr');
    const now = screen.getByRole('heading', { name: 'En cours' }).closest('section')!;
    expect(within(now).getByText('1 équipe')).toBeInTheDocument();
    expect(within(now).getByText('EN COURS')).toBeInTheDocument();
    expect(within(now).getByText('Seniors Manche 1 · course 2 sur 2')).toBeInTheDocument();
    expect(within(now).getByText('couloir 2 · 1er pour l’instant, 4 pts')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Trouver une équipe, un club ou une catégorie d’âge' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('fr');
  });
});

describe('Following page in Welsh', () => {
  beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: {}, headers: {} }); });

  it('offers the add link in Welsh', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1},{"competitionId":1,"teamId":2},{"competitionId":2,"teamId":3}]');
    render(<LanguageProvider initial="cy"><MemoryRouter><FollowingPage /></MemoryRouter></LanguageProvider>);
    expect(screen.getByRole('link', { name: 'Dilyn timau mewn cystadleuaeth arall' })).toHaveAttribute('href', '/events');
  });
});

const detail: TeamDetail = {
  teamId: 7,
  teamName: 'Meadow Cup Seniors 1',
  qualifyingPosition: 1,
  qualifyingPoints: 64,
  final: null,
  blocks: [{ key: 's1', kind: 'session', label: 'Session 1', points: 64, races: [{ id: 1, name: 'Bending', placing: 1, points: 8, eliminated: false, status: null }, { id: 2, name: 'Flags', placing: null, points: 0, eliminated: true, status: 2 }] } as never],
};

describe('Team sheet in French and Welsh', () => {
  it('translates the labels but not the team or race names', () => {
    render(<LanguageProvider initial="fr"><MemoryRouter><TeamSheet detail={detail} sectionName="Seniors" competitionId={4} onClose={vi.fn()} /></MemoryRouter></LanguageProvider>);
    const dialog = screen.getByRole('dialog', { name: 'Meadow Cup Seniors 1' });
    expect(dialog).toHaveAccessibleDescription('Seniors · a couru 1 session');
    expect(screen.getByRole('link', { name: 'Page complète de l’équipe' })).toHaveAttribute('href', '/competitions/4/teams/7');
    expect(screen.getByText('Qualifications')).toBeInTheDocument();
    expect(screen.getByText('1er · 64 pts')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Session 1' })).toHaveTextContent('Bending');
    // The status letters stay, the spoken label is French.
    expect(screen.getByText('Non-partant(e)')).toHaveClass('sr-only');
    expect(screen.getByText('DNS')).toBeInTheDocument();
  });

  it('uses Welsh ordinals and counts', () => {
    render(<LanguageProvider initial="cy"><MemoryRouter><TeamSheet detail={detail} sectionName={null} competitionId={4} onClose={vi.fn()} /></MemoryRouter></LanguageProvider>);
    expect(screen.getByText('1af · 64 pwynt')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tudalen lawn y tîm' })).toBeInTheDocument();
  });
});

vi.mock('./reliability/heatCalls', async (original) => ({ ...(await original<typeof import('./reliability/heatCalls')>()), useHeatCalls: () => ({ calls: [], error: '', reload: vi.fn() }) }));
