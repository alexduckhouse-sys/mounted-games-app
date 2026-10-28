import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { EmergencySearch } from './EmergencySearch';
import { EntriesPanel } from './EntriesPanel';
import { SponsorsSharingPage } from './SponsorsSharingPage';
import { ProtestsPanel } from './ProtestsPanel';
import { drawShareText } from './shareText';
import { entriesSummaryText } from './entryLogic';
import { tr, setActiveLang } from '../../i18n/translate';

vi.mock('../competition/context', () => ({
  useCompetition: () => ({ competition: { id: 7, name: 'Spring Open', sections: [] }, reload: vi.fn(), reloadSponsors: vi.fn() }),
}));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../competition/EmbedCard', () => ({ EmbedCard: () => <p>embed</p> }));

const mount = (lang: Lang, page: React.ReactElement) => render(<LanguageProvider initial={lang}><MemoryRouter>{page}</MemoryRouter></LanguageProvider>);

describe.each([
  { lang: 'cy' as const, nothing: 'Ni chaiff dim ei restru', find: 'Dod o hyd i feiciwr', noSponsors: 'Dim noddwyr eto', share: 'Rhannu', noTeams: 'Dim timau wedi cofrestru eto.', none: 'Dim gwrthwynebiadau.', heat: 'Sgwad 1' },
  { lang: 'fr' as const, nothing: 'Rien n’est affiché avant', find: 'Trouver un cavalier', noSponsors: 'Aucun sponsor pour l’instant', share: 'Partager', noTeams: 'Aucune équipe n’est encore inscrite.', none: 'Aucune réclamation.', heat: 'Manche 1' },
])('organiser pages, second half, in $lang', ({ lang, nothing, find, noSponsors, share, noTeams, none, heat }) => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); });
  afterEach(() => { setActiveLang('en'); });

  it('translates the emergency search', () => {
    mount(lang, <EmergencySearch competitionId={7} />);
    expect(screen.getByText(find)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(nothing))).toBeInTheDocument();
  });

  it('translates the entries list and the protests panel', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    mount(lang, <EntriesPanel canWrite onTimetableChanged={vi.fn()} />);
    expect(await screen.findByText(noTeams)).toBeInTheDocument();
    mount(lang, <ProtestsPanel competitionId={7} />);
    expect(await screen.findByText(none)).toBeInTheDocument();
  });

  it('translates sponsors and sharing', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    mount(lang, <SponsorsSharingPage />);
    expect(await screen.findByText(noSponsors)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: share })).toBeInTheDocument();
  });

  it('translates the words in shared text', () => {
    setActiveLang(lang);
    const text = drawShareText({ name: 'Spring Open' }, { name: 'Session 1', sectionName: 'U12', arenaName: null, heats: [{ id: 1, label: '', orderIndex: 1, scheduledStart: null, entries: [{ laneIndex: 1, teamName: 'Oak A' }] }] } as never, 'https://x/y');
    expect(text).toContain(heat);
    expect(text).not.toContain('Live times and scores');
    expect(entriesSummaryText('Spring Open', [], null)).not.toContain('entries');
    expect(tr('ops2.protest.heatN', { n: 2 })).not.toBe('Heat 2');
  });
});

describe('English is unchanged', () => {
  beforeEach(() => { setActiveLang('en'); });
  it('reads as before', () => {
    vi.useFakeTimers();
    mount('en', <EmergencySearch competitionId={7} />);
    act(() => { fireEvent.change(screen.getByLabelText('Find a rider'), { target: { value: 'a' } }); });
    expect(screen.getByText(/Type at least 2 letters to search/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
