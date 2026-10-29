import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { competition } from '../../test/factories';
import type { CompetitionSection } from '../../types';
import { CompetitionContext, type CompetitionCtx } from './context';
import { EntryPage } from './EntryPage';
import { DecFormList } from './DecFormList';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const sections: CompetitionSection[] = [
  { id: 5, competitionId: 1, format: 1, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 1500, maxParticipants: 10, activeSignupsCount: 4 },
];

function mount(lang: Lang) {
  const ctx = { competition: competition({ sections, name: 'TEST COMP1', createdByUserId: 'owner' }), reload: vi.fn() } as unknown as CompetitionCtx;
  return render(
    <LanguageProvider initial={lang}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/competitions/1/enter']}>
          <CompetitionContext.Provider value={ctx}>
            <Routes><Route path="/competitions/:id/enter/*" element={<EntryPage />} /></Routes>
          </CompetitionContext.Provider>
        </MemoryRouter>
      </AuthProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
});

describe.each([
  { lang: 'cy' as const, heading: 'Dewiswch eich cofrestriad', option: 'Pâr', places: '6 lle pâr ar ôl', steps: 'Camau cofrestru' },
  { lang: 'fr' as const, heading: 'Choisissez votre inscription', option: 'Paire', places: '6 places de paire restantes', steps: 'Étapes de l’inscription' },
])('the entry page in $lang', ({ lang, heading, option, places, steps }) => {
  it('translates the chrome and leaves the age group name and the fee as they are', async () => {
    mount(lang);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: steps })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Under 12/ })).toBeInTheDocument();
    expect(screen.getByText(places)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: new RegExp(`^${option}`) });
    expect(link).toHaveTextContent('£15');
  });
});

describe('the list of dec forms sent', () => {
  it('translates the labels and keeps team and rider names as given', () => {
    const form = {
      id: 1, teamId: 3, teamName: 'Stockport A', competitionId: 1, competitionName: 'TEST COMP1', submittedAt: '2026-10-23T10:00:00', submittedByName: 'Sam', submittedByUserId: 'u1',
      riders: [{ id: 1, fullName: 'Alex Rider', horseName: 'Pickle', orderIndex: 0, isReserve: false, isCaptain: false }],
    };
    render(
      <LanguageProvider initial="fr">
        <DecFormList forms={[form] as never} teams={[]} sections={[]} config={{ customFields: [] } as never} canDelete={() => true} onDelete={() => {}} />
      </LanguageProvider>,
    );
    expect(screen.getByRole('region', { name: 'Formulaires de déclaration envoyés' })).toBeInTheDocument();
    expect(screen.getByText('Stockport A')).toBeInTheDocument();
    expect(screen.getByText(/^Envoyé le /)).toBeInTheDocument();
    expect(screen.getByLabelText('Trouver une équipe, un cavalier ou un poney')).toBeInTheDocument();
  });
});
