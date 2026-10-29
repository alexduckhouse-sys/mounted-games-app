import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { EquipmentPage } from './EquipmentPage';
import { EventDetailsPage } from './EventDetailsPage';
import { OperationsPage } from './OperationsPage';
import { SectionsPage } from './SectionsPage';
import { TimetablePage } from './TimetablePage';

const session = (id: number, sectionId: number, name: string) => ({
  id, competitionId: 7, competitionSectionId: sectionId, name, arenaName: 'Main arena', kind: 0, isBreak: false, status: 0, orderIndex: id,
  minutesPerHeat: 10, lanesPerHeat: 6, heats: [], plannedRaces: ['Flag'], laneRotationMode: 0, raceOrderAlternating: false,
});
const competition = {
  id: 7, name: 'Spring Open', startDate: '2031-05-04T09:00:00.000Z', endDate: null, isActive: true, isArchived: false, laneHatbands: ['Red'],
  sections: [{ id: 11, format: 2, ageGroup: 'Under 12', displayName: 'Under 12', usesRaceFinals: false, tieBreakRule: 0, activeSignupsCount: 0, hasFinal: false }],
  teams: [],
  sessions: [session(1, 11, 'Under 12 · Session 1')],
};
const readiness = {
  competitionId: 7, isReady: false, equipmentFingerprint: 'v1',
  missingDeclarations: [{ teamId: 4, teamName: 'Oak A', sectionId: 11, sectionName: 'Under 12' }],
  unpaidSignups: [], incompleteTeams: [], sessionOverlaps: [],
  equipmentChecklist: [{ key: 'Lane|Pole|4', kind: 'Pole', bucket: 'Lane', count: 4, acknowledged: false, acknowledgedAt: null }],
  equipmentIssues: [],
};

vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition, reload: vi.fn() }) }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, canOrganise: () => true, hasRole: (role: string) => role === 'Admin' }),
}));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('./DrawUndoBanner', () => ({ DrawUndoBanner: () => null }));
vi.mock('../../lib/raceTemplates', async (original) => ({ ...(await original<typeof import('../../lib/raceTemplates')>()), loadRaceTemplates: () => Promise.resolve([]) }));

function mount(lang: Lang, page: React.ReactElement) {
  return render(<LanguageProvider initial={lang}><MemoryRouter>{page}</MemoryRouter></LanguageProvider>);
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('readiness')) return Promise.resolve({ data: readiness });
    if (url.includes('passport-check')) return Promise.resolve({ data: { enabled: false } });
    if (url.includes('tack-check')) return Promise.resolve({ data: { sections: [] } });
    if (url.includes('dec-form-config')) return Promise.resolve({ data: { config: {} } });
    return Promise.resolve({ data: [] });
  });
});

describe.each([
  { lang: 'cy' as const, hub: 'Cyn y diwrnod', toSort: 'peth i’w ddatrys', sortLine: '1 ffurflen ddatgan ar goll · 1 eitem o offer i’w gwirio', blocking: 'I’w datrys', tile: 'Dyblygu’r digwyddiad', recheck: 'Gwirio eto', big: 'Offer mawr', extras: 'Ychwanegion sgorio', moveAll: 'Symud popeth', hatbands: 'Bandiau het', about: 'Amdano', horsebox: 'Mynedfa’r bocs ceffylau', back: 'Yn ôl i Cyn y diwrnod' },
  { lang: 'fr' as const, hub: 'Avant le jour J', toSort: 'points à régler', sortLine: '1 formulaire de déclaration manquant · 1 élément d’équipement à vérifier', blocking: 'À régler', tile: 'Dupliquer l’événement', recheck: 'Revérifier', big: 'Gros équipement', extras: 'Options de notation', moveAll: 'Tout décaler', hatbands: 'Bandeaux', about: 'À propos', horsebox: 'Entrée des vans', back: 'Retour à Avant le jour J' },
])('organiser event pages in $lang', ({ lang, hub, toSort, sortLine, blocking, tile, recheck, big, extras, moveAll, hatbands, about, horsebox, back }) => {
  it('translates the Before the day hub', async () => {
    mount(lang, <OperationsPage />);
    expect(await screen.findByText(toSort)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: hub })).toBeInTheDocument();
    expect(screen.getByText(sortLine)).toBeInTheDocument();
    expect(screen.getByText(blocking)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(`^${tile}`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: recheck })).toBeInTheDocument();
    expect(screen.queryByText('things to sort')).not.toBeInTheDocument();
    expect(screen.queryByText('Event details')).not.toBeInTheDocument();
  });

  it('translates the equipment list', async () => {
    mount(lang, <EquipmentPage />);
    expect(await screen.findByText(big)).toBeInTheDocument();
    expect(screen.getByText(/^(1)? ?(sur|o) 1$/)).toBeInTheDocument();
  });

  it('translates sections and races', async () => {
    mount(lang, <SectionsPage />);
    const card = await screen.findByRole('region', { name: 'Under 12' });
    expect(within(card).getByText(extras)).toBeInTheDocument();
    expect(screen.queryByText('Scoring extras')).not.toBeInTheDocument();
  });

  it('translates the timetable and hatbands', async () => {
    mount(lang, <TimetablePage />);
    expect(await screen.findByText(moveAll)).toBeInTheDocument();
    expect(screen.getAllByText(hatbands).length).toBeGreaterThan(0);
    expect(screen.queryByText('Move everything')).not.toBeInTheDocument();
  });

  it('translates event details', async () => {
    mount(lang, <EventDetailsPage />);
    expect(await screen.findByText(about)).toBeInTheDocument();
    expect(screen.getAllByText(horsebox).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: new RegExp(back) })).toBeInTheDocument();
  });
});

vi.mock('../competition/reliability/SubstitutionRequests', () => ({ SubstitutionRequests: () => null }));

vi.mock('../../components/PaceReview', () => ({ PaceReview: () => null }));
