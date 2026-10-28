import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { SeasonPage } from './SeasonPage';
import { SeasonsPage } from './SeasonsPage';
import type { SeasonView } from './seasonViewTypes';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const season: SeasonView = {
  id: 'example-season', title: 'Example Summer League', year: 2026, format: 2, ageGroup: 'Seniors',
  bestResultsToCount: 1, placePoints: [{ place: 1, points: 10 }], canManage: false,
  rounds: [{ id: 'round-1', competitionId: 1, competitionName: 'Example Meadow Cup', competitionDate: '2026-06-01T00:00:00Z', competitionSectionId: 1, sectionName: 'Seniors', orderIndex: 1, isIncluded: true, publishedVersion: 1, publishedAt: '2026-06-01T17:00:00Z', publicationIsCurrent: true }],
};
const standings = { standings: [{ rank: 1, teamProfileId: 'team-a', teamName: 'Example Blue', clubName: 'Example Club', totalPoints: 10, rounds: [{ roundId: 'round-1', eventRank: 1, seasonPoints: 10, counted: true }] }] };

function mount(ui: ReactElement, path: string, lang: Lang) {
  return render(<LanguageProvider initial={lang}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/seasons" element={<SeasonsPage />} />
    <Route path="/seasons/:seasonId" element={ui} />
  </Routes></MemoryRouter></LanguageProvider>);
}

describe('Seasons in Welsh and French', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ user: null, canOrganise: () => false, hasRole: () => false, canEdit: () => false } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url.endsWith('/standings') ? standings : url === '/seasons' ? [season] : season }));
  });

  it('lists seasons in French', async () => {
    mount(<SeasonPage />, '/seasons', 'fr');
    const row = await screen.findByRole('link', { name: /Example Summer League/ });
    expect(row).toHaveTextContent('Équipes · Seniors · 1 manche · les 1 meilleurs comptent');
    expect(screen.getByRole('region', { name: 'Saisons 2026' })).toBeInTheDocument();
  });

  it('shows the table and rounds in Welsh', async () => {
    mount(<SeasonPage />, '/seasons/example-season', 'cy');
    expect(await screen.findByRole('link', { name: 'Safleoedd' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Tîm')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rowndiau' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Pwyn.' })).toBeInTheDocument();
  });
});
