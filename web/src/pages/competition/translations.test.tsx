import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { HeatRing } from '../../components/HeatRing';
import { SponsorBadge } from '../../components/SponsorBadge';
import { RoundStepper } from '../../components/RoundStepper';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { dayKey } from '../../lib/timetableDay';
import { buildToplist } from '../../lib/toplist';
import { competition, heat, session, standing } from '../../test/factories';
import { TackLeaderboard } from './TackLeaderboard';
import { TimetableBoard } from './TimetableBoard';
import { ToplistView } from './ToplistView';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context')>()), useCompetition: () => state.value }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => false }) }));

const inLang = (lang: Lang, ui: React.ReactNode) => render(<LanguageProvider initial={lang}><MemoryRouter>{ui}</MemoryRouter></LanguageProvider>);
const day = dayKey(new Date());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${day}T09:00:00`));
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('the toplist in Welsh and French', () => {
  const list = buildToplist([standing(1, 6), standing(2, 6), standing(3, 2)], [], [], 9, null);
  // Top 2 through, with notes as the qualification sums would give them.
  const withLine = buildToplist([standing(1, 6), standing(2, 5), standing(3, 2)], [], [], 9, 2);
  Object.assign(withLine.rows[0], { guaranteed: true, racesLeft: 1 });
  Object.assign(withLine.rows[1], { toStay: 1, racesLeft: 1 });
  Object.assign(withLine.rows[2], { needed: 4, racesLeft: 1 });

  it('translates the chrome and leaves team names as typed', () => {
    inLang('cy', <ToplistView list={list} section={null} />);
    const totals = screen.getByRole('region', { name: 'Cyfansymiau' });
    expect(within(totals).getAllByRole('listitem')[0]).toHaveTextContent('Team 1');
    expect(screen.getAllByText('(cyfartal)', { exact: false })).toHaveLength(2);
  });

  it('translates the cut-off line and the qualification notes into Welsh', () => {
    inLang('cy', <ToplistView list={withLine} section={null} />);
    expect(screen.getByRole('separator', { name: 'Terfyn Rownd Derfynol A' })).toBeInTheDocument();
    expect(screen.getByText('Lle yn Rownd Derfynol A yn sicr')).toBeInTheDocument();
    expect(screen.getByText('1 pwynt i aros yn Rownd Derfynol A')).toBeInTheDocument();
    expect(screen.getByText('Angen 4 pwynt i gyrraedd Rownd Derfynol A (canlyniadau arferol)')).toBeInTheDocument();
  });

  it('uses French wording and a French sr-only points label', () => {
    inLang('fr', <ToplistView list={list} section={null} />);
    expect(screen.getByRole('region', { name: 'Totaux' })).toBeInTheDocument();
    expect(screen.queryByText('−4')).toBeNull();
    expect(screen.getAllByText('points', { exact: false }).length).toBeGreaterThan(0);
  });

  it('translates the cut-off line and the qualification notes into French', () => {
    inLang('fr', <ToplistView list={withLine} section={null} />);
    expect(screen.getByRole('separator', { name: 'Seuil de la finale A' })).toBeInTheDocument();
    expect(screen.getByText('Place assurée en finale A')).toBeInTheDocument();
    expect(screen.getByText('1 pt pour rester en finale A')).toBeInTheDocument();
    expect(screen.getByText('Il faut 4 pts pour la finale A (arrivées normales)')).toBeInTheDocument();
  });

  it('shows the Show menu options in the chosen language', async () => {
    const withSessions = { ...list, bySession: { sessions: [{ id: 1, label: 'S1', title: 'Session 1' }], cells: new Map<number, number[]>() } };
    inLang('fr', <ToplistView list={withSessions} section={null} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Afficher' }));
    expect(screen.getByRole('option', { name: 'Par session' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Par session' }));
    expect(screen.getByRole('region', { name: 'Points par session' })).toBeInTheDocument();
  });
});

describe('the tack and turnout table in French', () => {
  it('translates the heading, note and unmarked cell', async () => {
    vi.useRealTimers();
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { sections: [{ sectionId: 5, sectionName: 'Under 12', mode: 1, maxPoints: 10, sectors: ['Bit'], rows: [{ rank: 1, teamId: 1, teamName: 'Oak A', clubName: 'Oak', points: [null], total: 0, isHorsConcours: false }] }] },
    } as never);
    inLang('fr', <TackLeaderboard competitionId={1} sectionId={5} />);
    expect(await screen.findByRole('heading', { name: 'Harnachement et tenue' })).toBeInTheDocument();
    expect(screen.getByText(/Tableau séparé/)).toBeInTheDocument();
    expect(screen.getByText('Non noté')).toBeInTheDocument();
    expect(screen.getByText('Oak A')).toBeInTheDocument();
  });
});

describe('the timetable in Welsh and French', () => {
  function setBoard(secondArena = 'Main Arena') {
    const sessions = [
      session(1, { status: 1, arenaName: 'Main Arena', scheduledStart: `${day}T10:00:00`, startedAt: `${day}T10:06:00`, heats: [heat(11, { sessionId: 1, orderIndex: 0, label: 'Heat 1' })] }),
      session(2, { status: 0, arenaName: secondArena, scheduledStart: `${day}T11:00:00`, heats: [heat(22, { sessionId: 2, orderIndex: 0 })] }),
    ];
    state.value = { competition: competition({ startDate: day, endDate: day, sessions }), reload: vi.fn(), updatedAt: null };
  }

  it('says an arena is running late in French, with the arena name as given', () => {
    setBoard();
    inLang('fr', <TimetableBoard />);
    expect(screen.getByRole('status')).toHaveTextContent('Main Arena a 6 minutes de retard');
    expect(screen.getAllByText('Main Arena · 1 manche').length).toBeGreaterThan(0);
    expect(screen.getByText('EN COURS')).toBeInTheDocument();
    expect(screen.getByText('Manche 1')).toBeInTheDocument();
  });

  it('uses Welsh for the key, the heat name and the show-all button', async () => {
    setBoard();
    inLang('cy', <TimetableBoard />);
    expect(screen.getByRole('list', { name: 'Lliwiau statws' })).toBeInTheDocument();
    expect(screen.getByText('Rhagras 1')).toBeInTheDocument();
    expect(screen.getAllByText('Main Arena · 1 rhagras').length).toBeGreaterThan(0);
  });

  it('keeps English with no provider', () => {
    setBoard();
    render(<MemoryRouter><TimetableBoard /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Main Arena is running 6 minutes late');
  });
});

describe('small shared pieces', () => {
  it('counts down in Welsh and French', () => {
    const at = new Date(Date.now() + 6 * 60_000);
    const { unmount } = inLang('cy', <HeatRing at={at} live={false} />);
    expect(screen.getByRole('img', { name: 'Yn dechrau ymhen 6 munud' })).toBeInTheDocument();
    unmount();
    inLang('fr', <HeatRing at={at} live={false} />);
    expect(screen.getByRole('img', { name: 'Départ dans 6 minutes' })).toBeInTheDocument();
  });

  it('labels the quantity stepper and the sponsor logo in the chosen language', () => {
    inLang('fr', <><RoundStepper name="Camping" value={1} onChange={() => {}} /><SponsorBadge sponsor={{ id: 1, name: 'Oak Feeds', logoUrl: '/logo.png', linkUrl: null, tier: 1 } as never} /></>);
    expect(screen.getByRole('group', { name: 'Quantité pour Camping' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retirer un Camping' })).toBeInTheDocument();
    expect(screen.getByText('Oak Feeds')).toBeInTheDocument();
  });
});
