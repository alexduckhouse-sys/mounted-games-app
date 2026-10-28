import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { setActiveLang, type Lang } from '../../i18n/translate';
import { resultsDigest } from '../../lib/resultsDigest';
import { paidWord } from '../../lib/paidWord';
import { PassportCheckTab } from './PassportCheckTab';
import { TackCheckTab } from './TackCheckTab';
import { ResultsBookTab } from './ResultsBookTab';
import { DuplicateEventPanel, PrintSheetsPanel, TeamImportPanel } from './EventToolsPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const mount = (lang: Lang, page: React.ReactElement) => render(<LanguageProvider initial={lang}><MemoryRouter>{page}</MemoryRouter></LanguageProvider>);

describe.each([
  { lang: 'cy' as const, passport: 'Archwilio pasbortau', check: 'Archwilio pasbortau yn y digwyddiad hwn', tack: 'Argraffu ffurflenni archwilio tac', book: 'Llyfr canlyniadau', dup: 'Dyblygu gosodiad y digwyddiad', sheets: 'Argraffu taflenni’r digwyddiad', imp: 'Mewnforio timau o CSV', paid: 'Talwyd', demo: 'Talwyd (arddangosiad)' },
  { lang: 'fr' as const, passport: 'Contrôle des passeports', check: 'Contrôler les passeports lors de cet événement', tack: 'Imprimer les formulaires de contrôle', book: 'Livre des résultats', dup: 'Dupliquer la configuration de l’événement', sheets: 'Imprimer les feuilles de l’événement', imp: 'Importer des équipes depuis un CSV', paid: 'Payé', demo: 'Payé (démo)' },
])('organiser event tools in $lang', ({ lang, passport, check, tack, book, dup, sheets, imp, paid, demo }) => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); });
  afterEach(() => { setActiveLang('en'); });

  it('translates the passport check', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { enabled: true, checked: 0, total: 0, sections: [] } });
    mount(lang, <PassportCheckTab competitionId="12" />);
    expect(await screen.findByLabelText(check)).toBeInTheDocument();
    expect(screen.getAllByText(passport).length).toBeGreaterThan(0);
  });

  it('translates the tack check and results book tabs', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { sections: [] } });
    const first = mount(lang, <TackCheckTab competitionId="12" />);
    expect(await screen.findByText(tack)).toBeInTheDocument();
    first.unmount();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    mount(lang, <ResultsBookTab competitionId="12" />);
    expect(screen.getAllByText(book).length).toBeGreaterThan(0);
  });

  it('translates the duplicate, import and print panels', () => {
    mount(lang, <><DuplicateEventPanel competition={{ id: 1, name: 'Spring Open' }} /><PrintSheetsPanel competitionId="1" /><TeamImportPanel competitionId="1" /></>);
    expect(screen.getAllByText(dup).length).toBeGreaterThan(0);
    expect(screen.getAllByText(sheets).length).toBeGreaterThan(0);
    expect(screen.getAllByText(imp).length).toBeGreaterThan(0);
  });

  it('translates shared text and the paid word', () => {
    setActiveLang(lang);
    expect(paidWord(false)).toBe(paid);
    expect(paidWord(true)).toBe(demo);
    const book = { competition: { id: 1, name: 'Spring Open' }, isProvisional: true, includesPrivate: false, sections: [], eventAwards: [], refereeNotes: [] };
    expect(resultsDigest(book as never)).not.toContain('Provisional results');
  });
});

describe('English is unchanged', () => {
  it('keeps the usual words', () => {
    setActiveLang('en');
    expect(paidWord(false)).toBe('Paid');
    expect(paidWord(true)).toBe('Demo paid');
  });
});
