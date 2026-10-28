import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { AdminCompetitionsPage } from './AdminCompetitionsPage';
import { BlockedAccountsPage } from './BlockedAccountsPage';
import { CompetitionEditor } from './CompetitionEditor';
import { SiteAdminDashboard } from './SiteAdminDashboard';
import { TrainerRequestsPage } from './TrainerRequestsPage';
import { UsersPage } from './UsersPage';
import { deleteWarning } from './adminShared';
import { accountKind } from './accountAccessTypes';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', roles: ['Admin', 'MasterAdmin'] }, hasRole: () => true, canOrganise: () => true }),
}));

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const comp = { id: 1, name: 'Spring Open', location: 'X', startDate: future(10), endDate: future(11), isActive: true, isArchived: false, sectionCount: 3, teamCount: 12, sessionCount: 0 };
const request = { userId: 'u1', fullName: 'Ann', email: 'u1@example.com', clubName: null, requestedAt: '2026-10-20T10:00:00Z' };

const mount = (lang: Lang, ui: React.ReactNode) => render(<LanguageProvider initial={lang}><MemoryRouter>{ui}</MemoryRouter></LanguageProvider>);

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/competitions') return { data: [comp] } as never;
    if (url === '/admin/trainer-requests') return { data: [request] } as never;
    if (url === '/race-templates') return { data: [{ id: 1 }, { id: 2 }] } as never;
    return { data: [] } as never;
  });
});

describe('site admin accounts screens in French and Welsh', () => {
  it('translates the dashboard', async () => {
    mount('fr', <SiteAdminDashboard />);
    expect(await screen.findByRole('heading', { name: 'À traiter' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gérer le site' })).toBeInTheDocument();
    expect(screen.getByText('Demande d’entraîneur à approuver')).toBeInTheDocument();
    expect(screen.getByText('2 courses')).toBeInTheDocument();
    expect(screen.queryByText('Manage the site')).not.toBeInTheDocument();
  });

  it('translates the competitions list and its delete warning', async () => {
    mount('cy', <AdminCompetitionsPage />);
    expect(await screen.findByRole('link', { name: 'Trefnu Spring Open' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /I ddod/ })).toBeInTheDocument();
    expect(screen.getByText('Cystadleuaeth newydd')).toBeInTheDocument();
    expect(screen.queryByText('Organise')).not.toBeInTheDocument();
  });

  it('translates the users page', async () => {
    mount('fr', <UsersPage />);
    expect(await screen.findByRole('heading', { name: 'Inviter un administrateur' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tous les autres' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoyer l’invitation' })).toBeInTheDocument();
    expect(screen.queryByText('Invite an admin')).not.toBeInTheDocument();
  });

  it('translates trainer requests and blocked accounts', async () => {
    const { unmount } = mount('fr', <TrainerRequestsPage />);
    expect(await screen.findByRole('button', { name: 'Approuver Ann' })).toBeInTheDocument();
    expect(screen.getByText(/Aucun club indiqué/)).toBeInTheDocument();
    expect(screen.queryByText('Approve all')).not.toBeInTheDocument();
    unmount();
    mount('cy', <BlockedAccountsPage />);
    expect(await screen.findByText('Neb wedi’i flocio')).toBeInTheDocument();
  });

  it('translates the competition editor', async () => {
    render(
      <LanguageProvider initial="fr"><MemoryRouter initialEntries={['/admin/competitions/new']}>
        <Routes><Route path="/admin/competitions/new" element={<CompetitionEditor />} /></Routes>
      </MemoryRouter></LanguageProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Nouvelle compétition' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Suivant/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'New competition' })).not.toBeInTheDocument();
  });

  it('translates helper text built in plain code', () => {
    expect(accountKind(['Trainer'])).toBe('Organiser');
    expect(deleteWarning({ teamCount: 1, sectionCount: 2, sessionCount: 3 }, true)).toMatch(/^It’s running now\. Its 1 team, 2 age groups and 3 sessions/);
  });
});
