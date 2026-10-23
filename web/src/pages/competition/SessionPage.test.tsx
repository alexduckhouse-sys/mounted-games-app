import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, heat, race, result, session, team } from '../../test/factories';
import type { HeatEntry } from '../../types';
import type { CompetitionDetail, DeclarationForm } from '../../types';
import { CompetitionContext } from './context';
import { SessionPage } from './SessionPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./HeatScores', () => ({ HeatScores: () => <p>Public results</p> }));
const auth = vi.hoisted(() => ({ manage: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ canManage: () => auth.manage, canEdit: () => true, canOrganise: () => true, hasRole: () => true, user: null }),
}));

const form = (teamId: number): DeclarationForm => ({
  id: teamId, teamId, teamName: `Team ${teamId}`, competitionId: 1, competitionName: 'Spring Games',
  submittedAt: '2026-06-01T09:00:00Z', isLocked: false, riders: [],
});

function mount(data: CompetitionDetail, forms: DeclarationForm[] = []) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/declaration-forms') return Promise.resolve({ data: forms });
    return Promise.resolve({ data: [] });
  });
  return render(
    <MemoryRouter initialEntries={['/competitions/1/session/1']}>
      <CompetitionContext.Provider value={{
        competition: data, reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [],
      }}>
        <Routes><Route path="/competitions/:id/session/:sessionId" element={<SessionPage />} /></Routes>
      </CompetitionContext.Provider>
    </MemoryRouter>,
  );
}

const entries = (n: number): HeatEntry[] => Array.from({ length: n }, (_, i) => ({
  id: i + 1, teamId: i + 1, teamName: `Rider ${i + 1}`, laneIndex: i + 1,
}));
const scoringData = (n = 4) => competition({
  teams,
  sessions: [session(1, { status: 1, heats: [heat(1, { entries: entries(n), races: [race(1, { name: 'Bending' }), race(2, { name: 'Flag' })] })] })],
});
const tile = (name: string) => screen.getByText(name).closest('div[class*="rounded-xl"]') as HTMLElement;
// Taps a rider and waits until the Save button counts `placed` results. Framer Motion drops an
// occasional tap when clicks follow each other very quickly in jsdom, so a tap that has not counted is repeated.
async function tapRider(name: string, placed: number) {
  const label = `Save ${placed} result${placed === 1 ? '' : 's'}`;
  for (let attempt = 0; attempt < 4 && !screen.queryByRole('button', { name: label }); attempt++) {
    await userEvent.click(screen.getByText(name));
    try {
      await screen.findByRole('button', { name: label }, { timeout: 1500 });
    } catch { /* not registered: tap again */ }
  }
}
const badge = (name: string) => within(tile(name)).queryByText(/^\d+$/, { selector: 'div' });

const teams = [team(1, { displayName: 'Oak A' }), team(2, { displayName: 'Beech B' }), team(3, { displayName: 'Ash C' })];

describe('SessionPage', () => {
  beforeEach(() => { auth.manage = true; vi.mocked(api.get).mockResolvedValue({ data: [] }); });
  afterEach(() => { vi.useRealTimers(); });

  describe('who may score', () => {
    const open = () => competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { races: [race(1, { name: 'Bending' })] })] })] });

    it('shows the scoring view, heat set-up and score record to someone who can manage this competition', async () => {
      mount(open());
      expect(screen.getByRole('heading', { name: /Scoring · Bending/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Set up heats/ })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Sessions/ })).toBeInTheDocument();
      await waitFor(() => expect(api.get).toHaveBeenCalledWith('/races/1/score'));
    });

    it('shows only the results to everyone else', () => {
      auth.manage = false;
      mount(open());
      expect(screen.queryByRole('heading', { name: /Scoring · Bending/ })).not.toBeInTheDocument();
      expect(screen.getByText('Public results')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Set up heats/ })).not.toBeInTheDocument();
      expect(api.get).not.toHaveBeenCalledWith('/races/1/score');
    });
  });

  it('selects the first unfinished heat when none is requested', () => {
    const done = heat(1, { label: 'Heat 1', orderIndex: 0, races: [race(1, { isComplete: true })] });
    const open = heat(2, { label: 'Heat 2', orderIndex: 1, races: [race(2, { name: 'Bending' })] });
    mount(competition({ teams, sessions: [session(1, { status: 1, heats: [done, open] })] }));
    expect(screen.getByRole('heading', { name: /Scoring · Bending/ })).toBeInTheDocument();
  });

  it('offers the end-of-session screen when every heat is complete, and lets it be closed', async () => {
    const finished = heat(1, { races: [race(1, { isComplete: true })] });
    mount(competition({ teams, sessions: [session(1, { status: 1, heats: [finished] })] }));
    expect(await screen.findByRole('heading', { name: 'Session complete' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('heading', { name: 'Session complete' }).closest('div')!.parentElement!.querySelector('button')!);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Session complete' })).not.toBeInTheDocument());
  });

  it('does not offer the end-of-session screen for a session already marked finished', () => {
    const finished = heat(1, { races: [race(1, { isComplete: true })] });
    mount(competition({ teams, sessions: [session(1, { status: 2, heats: [finished] })] }));
    expect(screen.queryByRole('heading', { name: 'Session complete' })).not.toBeInTheDocument();
  });

  it('has no race clock or start and stop buttons', () => {
    const running = race(1, { name: 'Bending', startedAt: '2026-06-01T10:00:00Z' });
    mount(competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { races: [running] })] })] }));
    expect(screen.getByRole('heading', { name: /Scoring · Bending/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Start|Stop)$/ })).not.toBeInTheDocument();
  });

  describe('placing teams', () => {
    it('gives each tapped team the next place, and closes the gap when one is tapped again', async () => {
      mount(scoringData());
      await tapRider('Rider 3', 1);
      await tapRider('Rider 1', 2);
      await tapRider('Rider 2', 3);
      expect(badge('Rider 3')).toHaveTextContent('1');
      expect(badge('Rider 1')).toHaveTextContent('2');
      expect(badge('Rider 2')).toHaveTextContent('3');
      await userEvent.click(screen.getByText('Rider 3'));
      await waitFor(() => expect(badge('Rider 3')).toBeNull());
      expect(badge('Rider 1')).toHaveTextContent('1');
      expect(badge('Rider 2')).toHaveTextContent('2');
    });

    it('does not place the last team by itself', async () => {
      mount(scoringData(3));
      await tapRider('Rider 1', 1);
      await tapRider('Rider 2', 2);
      expect(badge('Rider 3')).toBeNull();
      expect(screen.getByRole('button', { name: 'Save 2 results' })).toBeInTheDocument();
    });
  });

  describe('draft placings', () => {
    const draftKey = (raceId: number) => `mg.draft.scoring:1:${raceId}`;
    const keepDraft = (raceId: number, places: Array<{ teamId: number; place: number; eliminated: boolean }>) =>
      localStorage.setItem(draftKey(raceId), JSON.stringify(places));
    const finishedBending = () => race(1, { name: 'Bending', isComplete: true, results: [result(1, 1), result(3, 2)] });
    const withFinishedRace = () => competition({
      teams,
      sessions: [session(1, { status: 1, heats: [heat(1, { entries: entries(3), races: [finishedBending(), race(2, { name: 'Flag' })] })] })],
    });

    it('restores the draft saved for the race being scored', async () => {
      keepDraft(1, [{ teamId: 2, place: 1, eliminated: false }, { teamId: 1, place: 2, eliminated: false }]);
      mount(scoringData(3));
      await waitFor(() => expect(badge('Rider 2')).toHaveTextContent('1'));
      expect(badge('Rider 1')).toHaveTextContent('2');
      expect(badge('Rider 3')).toBeNull();
      expect(screen.getByRole('button', { name: 'Save 2 results' })).toBeInTheDocument();
    });

    it('leaves a draft for a different race alone until that race is opened', async () => {
      keepDraft(2, [{ teamId: 2, place: 1, eliminated: false }]);
      mount(scoringData(3));
      await screen.findByRole('heading', { name: 'Scoring · Bending' });
      expect(badge('Rider 2')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: /Flag/ }));
      await waitFor(() => expect(badge('Rider 2')).toHaveTextContent('1'));
    });

    it('prefers the draft to the saved results of a finished race', async () => {
      keepDraft(1, [{ teamId: 3, place: 1, eliminated: false }]);
      mount(withFinishedRace());
      await userEvent.click(screen.getByRole('button', { name: /Bending/ }));
      await waitFor(() => expect(badge('Rider 3')).toHaveTextContent('1'));
      expect(badge('Rider 1')).toBeNull();
    });

    it('shows the saved results of a finished race when there is no draft, without keeping them as a draft', async () => {
      mount(withFinishedRace());
      await userEvent.click(screen.getByRole('button', { name: /Bending/ }));
      await waitFor(() => expect(badge('Rider 3')).toHaveTextContent('2'));
      expect(badge('Rider 1')).toHaveTextContent('1');
      expect(localStorage.getItem(draftKey(1))).toBeNull();
    });

    it('saves what is entered, and drops the draft once the race is saved', async () => {
      mount(scoringData(2));
      await tapRider('Rider 2', 1);
      await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey(1))!)).toEqual([{ teamId: 2, place: 1, eliminated: false }]));
      await tapRider('Rider 1', 2);
      await userEvent.click(screen.getByRole('button', { name: /^Save 2 results$/ }));
      await screen.findByRole('heading', { name: 'Scoring · Flag' });
      expect(localStorage.getItem(draftKey(1))).toBeNull();
    });

    it('ignores a damaged draft', async () => {
      localStorage.setItem(draftKey(1), '{oops');
      mount(scoringData(2));
      await screen.findByRole('heading', { name: 'Scoring · Bending' });
      expect(badge('Rider 1')).toBeNull();
    });
  });

  describe('moving on after saving a race', () => {
    const twoHeats = (alternating: boolean) => competition({
      teams,
      sessions: [session(1, {
        status: 1,
        raceOrderAlternating: alternating,
        heats: [1, 2].map((n) => heat(n, {
          label: `Heat ${n}`,
          entries: entries(2),
          races: [1, 2].map((r) => race(n * 10 + r, { name: `H${n} R${r}`, orderIndex: r, heatId: n })),
        })),
      })],
    });
    const saveRace = async () => {
      await tapRider('Rider 1', 1);
      await tapRider('Rider 2', 2);
      await userEvent.click(screen.getByRole('button', { name: /^Save 2 results$/ }));
    };
    const scoring = (name: string) => screen.findByRole('heading', { name: `Scoring · ${name}` });

    it('runs through one heat before starting the next', async () => {
      mount(twoHeats(false));
      await scoring('H1 R1');
      await saveRace();
      await scoring('H1 R2');
      await saveRace();
      await scoring('H2 R1');
    }, 60_000);

    it('goes across the heats for each race when the session alternates', async () => {
      mount(twoHeats(true));
      await scoring('H1 R1');
      await saveRace();
      await scoring('H2 R1');
      await saveRace();
      await scoring('H1 R2');
    }, 60_000);
  });

  describe('more teams than lanes', () => {
    const fourTeams = [1, 2, 3, 4].map((id) => ({ id, teamId: id, teamName: `Team ${id}`, laneIndex: id }));
    const sevenFour = () => competition({
      teams: [team(1, { displayName: 'Team 1' }), team(2, { displayName: 'Team 2' }), team(3, { displayName: 'Team 3' }), team(4, { displayName: 'Team 4' })],
      sessions: [session(1, { status: 1, lanesPerHeat: 3, heats: [heat(1, { entries: fourTeams, races: [race(1, { name: 'Bending' }), race(2, { name: 'Mug', orderIndex: 2 })] })] })],
    });

    it('shows S for the team without a lane, and does not let it be tapped into a place', async () => {
      mount(sevenFour());
      expect(await screen.findByTitle('Lane S')).toHaveTextContent('S');
      expect(screen.getAllByTitle(/^Lane [123]$/)).toHaveLength(3);
      await userEvent.click(screen.getByText('Team 4'));
      expect(screen.getByRole('button', { name: 'Save 0 results' })).toBeInTheDocument();
    });

    it('sends the sitting-out team with no place when the race is saved', async () => {
      mount(sevenFour());
      for (const name of ['Team 1', 'Team 2', 'Team 3']) await userEvent.click(await screen.findByText(name));
      await userEvent.click(screen.getByRole('button', { name: 'Save 3 results' }));
      const outbox = JSON.parse(localStorage.getItem('mg.outbox.scores') ?? '[]') as { places: { teamId: number; place: number; eliminated: boolean }[] }[];
      expect(outbox[0].places).toEqual([
        { teamId: 1, place: 1, eliminated: false },
        { teamId: 2, place: 2, eliminated: false },
        { teamId: 3, place: 3, eliminated: false },
        { teamId: 4, place: 0, eliminated: false },
      ]);
    });
  });

  describe('heat-heat-final', () => {
    const entries = [1, 2, 3, 4].map((id) => ({ id, teamId: id, teamName: `Team ${id}`, laneIndex: id }));
    const round = (stage: 1 | 2) => competition({
      teams: [team(1, { displayName: 'Team 1' }), team(2, { displayName: 'Team 2' }), team(3, { displayName: 'Team 3' }), team(4, { displayName: 'Team 4' })],
      sessions: [session(1, { status: 1, qualifiersPerHeat: 2, heats: [heat(1, { raceRoundId: 5, raceRoundStage: stage, entries, races: [race(1, { name: 'Bending' })] })] })],
    });

    it('only asks for the qualifying places, then eliminates anyone tapped after them', async () => {
      mount(round(1));
      expect(await screen.findByText(/Tap the first 2 teams home/)).toBeInTheDocument();
      for (const name of ['Team 1', 'Team 2', 'Team 3']) await userEvent.click(screen.getByText(name));
      expect(screen.getByText('ELIM')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Save 3 results' }));
      const outbox = JSON.parse(localStorage.getItem('mg.outbox.scores') ?? '[]') as { places: { teamId: number; place: number; eliminated: boolean }[] }[];
      // Team 4 was never tapped: it finishes after the qualifiers, on the qualifier's one point.
      expect(outbox[0].places).toEqual([
        { teamId: 1, place: 1, eliminated: false },
        { teamId: 2, place: 2, eliminated: false },
        { teamId: 3, place: 3, eliminated: true },
        { teamId: 4, place: 3, eliminated: false },
      ]);
    });

    it('does not ask for qualifiers in the final', async () => {
      mount(round(2));
      expect(await screen.findByText(/Tap a team to assign its place/)).toBeInTheDocument();
      expect(screen.queryByText(/Tap the first/)).not.toBeInTheDocument();
    });
  });

  it('shows a dash for a race that has not started', () => {
    mount(competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { races: [race(1)] })] })] }));
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  describe('Set up heats', () => {
    const data = () => competition({ teams, sessions: [session(1, { status: 0, heats: [] })] });

    it('starts with the teams that have a dec form selected, once the forms are in', async () => {
      mount(data(), [form(1), form(2)]);
      await userEvent.click(screen.getByRole('button', { name: /Set up heats/ }));
      expect(await screen.findByText(/Teams \(2 selected\)/)).toBeInTheDocument();
      expect(screen.getByText('2 dec forms in')).toBeInTheDocument();
    });

    it('selects every team when none has a dec form', async () => {
      mount(data(), []);
      await userEvent.click(screen.getByRole('button', { name: /Set up heats/ }));
      expect(await screen.findByText(/Teams \(3 selected\)/)).toBeInTheDocument();
    });

    it('keeps the trainer own choices: None, then a single team', async () => {
      mount(data(), [form(1), form(2)]);
      await userEvent.click(screen.getByRole('button', { name: /Set up heats/ }));
      await screen.findByText(/Teams \(2 selected\)/);
      await userEvent.click(screen.getByRole('button', { name: 'None' }));
      expect(screen.getByText(/Teams \(0 selected\)/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('checkbox', { name: /Oak A/ }));
      expect(screen.getByText(/Teams \(1 selected\)/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('checkbox', { name: /Oak A/ }));
      expect(screen.getByText(/Teams \(0 selected\)/)).toBeInTheDocument();
    });

    it('treats a failed dec form request as no forms', async () => {
      mount(data());
      vi.mocked(api.get).mockImplementation((url: string) => (
        url === '/declaration-forms' ? Promise.reject(new Error('offline')) : Promise.resolve({ data: [] })
      ));
      await userEvent.click(screen.getByRole('button', { name: /Set up heats/ }));
      expect(await screen.findByText('0 dec forms in')).toBeInTheDocument();
      expect(screen.getByText(/Teams \(3 selected\)/)).toBeInTheDocument();
    });
  });
});
