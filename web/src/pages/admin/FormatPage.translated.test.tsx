import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { resetRaceTemplates } from '../../lib/raceTemplates';
import { competition, session } from '../../test/factories';
import { DecFormConfigEditor } from './DecFormConfig';
import { FormatPage } from './FormatPage';
import { RaceListDialog } from './RaceListDialog';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => true }) }));

const start = new Date(2026, 9, 31, 9, 0).toISOString();

beforeEach(() => {
  resetRaceTemplates();
  localStorage.clear();
  const comp = competition({
    id: 5, name: 'Cheshire Pairs', startDate: start, signupsLocked: true,
    sections: [{ id: 1, competitionId: 5, format: 1, ageGroup: 'Junior', displayName: 'Junior pairs', runoffRaceName: 'Speed Weave', finalistCount: 6, usesRaceFinals: false }],
    teams: [],
    sessions: [session(10, { competitionSectionId: 1, name: 'Junior pairs', orderIndex: 1, plannedRaces: ['Bending'] })],
  });
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/competitions/5') return { data: comp } as never;
    if (url === '/competitions/5/signups') return { data: [] } as never;
    if (url === '/race-templates') return { data: [] } as never;
    return { data: [] } as never;
  });
});

function page(lang: Lang) {
  return render(
    <LanguageProvider initial={lang}>
      <MemoryRouter initialEntries={['/admin/competitions/5/format']}><Routes><Route path="/admin/competitions/:id/format" element={<FormatPage />} /></Routes></MemoryRouter>
    </LanguageProvider>,
  );
}

describe('On the day in French and Welsh', () => {
  it('reads in French', async () => {
    page('fr');
    expect(await screen.findByRole('heading', { level: 1, name: 'Le jour J' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Modifier la structure' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Générer le programme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Courses de Junior pairs : 1 courses/ })).toBeInTheDocument();
    expect(screen.queryByText('On the day')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate timetable' })).not.toBeInTheDocument();
  });

  it('reads in Welsh', async () => {
    page('cy');
    expect(await screen.findByRole('heading', { level: 1, name: 'Ar y diwrnod' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cynhyrchu’r amserlen' })).toBeInTheDocument();
    expect(screen.queryByText('Change the structure')).not.toBeInTheDocument();
  });

  it('translates the dec form setup and the race list dialog', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { isStandard: true, formsSubmitted: 0, config: { customFields: [], dobFormat: 0, weightUnit: 0, trainerPhone: 2, bib: 1, dob: 2, weight: 0, ponyHeight: 1, ponyPassport: 1, ponyAge: 0, membershipNumber: 1, emergencyContact: 1, medicalNotes: 0 } } } as never);
    const user = userEvent.setup();
    render(<LanguageProvider initial="fr"><DecFormConfigEditor competitionId={5} /></LanguageProvider>);
    expect(await screen.findByText('Utiliser le formulaire standard')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ajouter une question' }));
    expect(screen.getByText('Réponse obligatoire')).toBeInTheDocument();
    expect(screen.queryByText('Must be answered')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Donnez un nom à chaque champ supplémentaire.')).toBeInTheDocument());
  });

  it('translates the race list dialog', () => {
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
    render(<LanguageProvider initial="cy"><RaceListDialog title="Rasys" races={[]} format={1} ageGroup="" templates={[]} onSave={() => {}} onClose={() => {}} /></LanguageProvider>);
    expect(screen.getByText('Dim rasys eto. Ychwanegwch un isod.')).toBeInTheDocument();
    expect(screen.getByText('Cadw’r rhestr rasys')).toBeInTheDocument();
    expect(screen.queryByText('Save race list')).not.toBeInTheDocument();
  });
});
