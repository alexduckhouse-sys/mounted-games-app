import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import type { StatsProfile } from '../../types';
import { StatsPage } from './StatsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const summary = {
  competitions: 2, entries: 2, placedEntries: 1, firsts: 1, seconds: 0, thirds: 0, averagePlace: 1,
  entriesWithFinals: 0, finalsReached: 0, aFinals: 0, aFinalPercent: null, races: 2, wins: 1, winPercent: 50,
  points: 3, maxPoints: 6, pointQuotaPercent: 50,
};
const profile: StatsProfile = {
  kind: 0, name: 'Oliver S.', key: 'oliver s.', detailed: false, raceFiguresAllFormats: false, summary,
  games: null, bestGames: null, worstGames: null, entries: null, partnerships: null,
};

function mount(path: string, lang: Lang) {
  return render(<LanguageProvider initial={lang}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/stats" element={<StatsPage />} />
    <Route path="/stats/:kind" element={<StatsPage />} />
  </Routes></MemoryRouter></LanguageProvider>);
}

describe('Stats in Welsh and French', () => {
  beforeEach(() => { vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>); });

  it('browses riders in French', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { kind: 0, query: '', page: 1, pageSize: 24, total: 2, items: [{ kind: 0, name: 'Arthur Barker', key: 'arthur barker', competitions: 2 }, { kind: 0, name: 'Owen Barker', key: 'owen barker', competitions: 1 }] } });
    mount('/stats', 'fr');
    expect(await screen.findByRole('region', { name: 'Cavaliers B' })).toHaveTextContent('2 cavaliers');
    expect(screen.getByRole('link', { name: 'Cavaliers' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Seules les compétitions terminées comptent/)).toBeInTheDocument();
    expect(screen.queryByText(/Only finished competitions/)).not.toBeInTheDocument();
  });

  it('shows a profile summary in Welsh', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: profile });
    mount('/stats/riders?name=oliver%20s.', 'cy');
    expect((await screen.findAllByText('Cystadlaethau')).length).toBeGreaterThan(0);
    expect(screen.getByText('1af 1 · 2il 0 · 3ydd 0')).toBeInTheDocument();
    expect(screen.getByText('3 o 6 pwynt')).toBeInTheDocument();
    expect(screen.getByText('1 o 2 ras')).toBeInTheDocument();
    // Nothing asks a visitor to sign in any more.
    expect(screen.queryByRole('link', { name: 'Mewngofnodi' })).not.toBeInTheDocument();
  });
});
