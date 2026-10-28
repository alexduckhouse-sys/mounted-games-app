import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { useCompetition } from '../competition/context';
import { CommerceManagementPage } from './CommerceManagementPage';
import { CommerceOrdersPage } from './CommerceOrdersPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../competition/context', () => ({ useCompetition: vi.fn() }));

const mount = (lang: Lang, page: React.ReactElement) => render(<LanguageProvider initial={lang}><MemoryRouter>{page}</MemoryRouter></LanguageProvider>);

describe.each([
  { lang: 'cy' as const, items: 'Eitemau', orders: 'Archebion', toApprove: 'I’w cymeradwyo', nothing: 'Dim byd yn aros.', bought: 'Prynwyd', none: 'Dydych chi ddim wedi prynu dim eto.' },
  { lang: 'fr' as const, items: 'Articles', orders: 'Commandes', toApprove: 'À approuver', nothing: 'Rien en attente.', bought: 'Achats', none: 'Vous n’avez encore rien acheté.' },
])('event shop pages in $lang', ({ lang, items, orders, toApprove, nothing, bought, none }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'organiser' }, canOrganise: () => true } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useCompetition).mockReturnValue({ competition: { id: 5, name: 'Autumn Games' }, reload: vi.fn() } as unknown as ReturnType<typeof useCompetition>);
    vi.mocked(api.get).mockImplementation(async (url) => (String(url).endsWith('/settings') ? { data: { competitionId: 5, isDemo: false, isLocked: false } } : { data: [] }) as never);
  });

  it('translates the shop management page', async () => {
    mount(lang, <CommerceManagementPage />);
    expect(await screen.findByRole('tab', { name: items })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: orders })).toBeInTheDocument();
    expect(await screen.findByText(nothing)).toBeInTheDocument();
    expect(screen.getByText(toApprove)).toBeInTheDocument();
  });

  it('translates orders and sales', async () => {
    mount(lang, <CommerceOrdersPage />);
    expect(await screen.findByRole('tab', { name: bought })).toBeInTheDocument();
    expect(await screen.findByText(none)).toBeInTheDocument();
  });
});
