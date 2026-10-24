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
import { formatPoints } from '../../lib/formatPoints';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./HeatScores', () => ({ HeatScores: () => <p>Public results</p> }));
vi.mock('../../components/RaceRulesButton', () => ({ RaceRulesButton: ({ raceName }: { raceName: string }) => <button type="button">Rules for {raceName}</button> }));
const auth = vi.hoisted(() => ({ manage: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ canManage: () => auth.manage, canEdit: () => true, canOrganise: () => true, hasRole: () => true, user: null }),
}));

const form = (teamId: number): DeclarationForm => ({
  id: teamId, teamId, teamName: `Team ${teamId}`, competitionId: 1, competitionName: 'Spring Games',
  submittedAt: '2026-06-01T09:00:00Z', isLocked: false, riders: [],
});

const emptyScorerLinks = { arenas: ['Main arena', 'All arenas'], defaultExpiresAt: '2026-11-02T00:00:00Z', links: [] };

function mount(data: CompetitionDetail, forms: DeclarationForm[] = [], reload = vi.fn()) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/declaration-forms') return Promise.resolve({ data: forms });
    if (String(url).endsWith('/scorer-links')) return Promise.resolve({ data: emptyScorerLinks });
    return Promise.resolve({ data: [] });
  });
  return render(
    <MemoryRouter initialEntries={['/competitions/1/session/1']}>
      <CompetitionContext.Provider value={{
        competition: data, reload, streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [],
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
const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, lane`) }).closest('li') as HTMLElement;
const placed = () => screen.queryAllByLabelText(/^Place \d+$/).length;
const opened = (raceName: string) => screen.findByRole('region', { name: `Scoring ${raceName}` });
// Taps a rider and waits until `count` teams are placed. Framer Motion drops an occasional tap when clicks
// follow each other very quickly in jsdom, so a tap that has not counted is repeated.
async function tapRider(name: string, count: number) {
  for (let attempt = 0; attempt < 4 && placed() < count; attempt++) {
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}, lane`) }));
    try {
      await waitFor(() => expect(placed()).toBe(count), { timeout: 1500 });
    } catch { /* not registered: tap again */ }
  }
}
const badge = (name: string) => within(row(name)).queryByLabelText(/^Place \d+$/);
const completeRace = () => userEvent.click(screen.getByRole('button', { name: 'Race complete' }));
const outbox = () => JSON.parse(localStorage.getItem('mg.outbox.scores') ?? '[]') as { raceId: number; reason?: string; places: { teamId: number; place: number; eliminated: boolean; status?: number; refereeNote?: string }[] }[];

const teams = [team(1, { displayName: 'Oak A' }), team(2, { displayName: 'Beech B' }), team(3, { displayName: 'Ash C' })];

describe('SessionPage', () => {
  beforeEach(() => { auth.manage = true; vi.mocked(api.get).mockResolvedValue({ data: [] }); });
  afterEach(() => { vi.useRealTimers(); });

  describe('who may score', () => {
    const open = () => competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { races: [race(1, { name: 'Bending' })] })] })] });

    it('shows the scoring view, the organiser tools, and no score record or sign-off, to someone who can manage this competition', async () => {
      mount(open());
      expect(screen.getByRole('region', { name: 'Scoring Bending' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Set up heats/ })).toBeInTheDocument();
      expect(screen.queryByText('Score record')).not.toBeInTheDocument();
      expect(screen.queryByText(/Sign off/)).not.toBeInTheDocument();
      expect(screen.queryByText('History')).not.toBeInTheDocument();
    });

    it('shows only the results to everyone else', () => {
      auth.manage = false;
      mount(open());
      expect(screen.queryByRole('region', { name: 'Scoring Bending' })).not.toBeInTheDocument();
      expect(screen.getByText('Public results')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Set up heats/ })).not.toBeInTheDocument();
      expect(api.get).not.toHaveBeenCalledWith('/races/1/score');
    });
  });

  it('selects the first unfinished heat when none is requested', () => {
    const done = heat(1, { label: 'Heat 1', orderIndex: 0, races: [race(1, { isComplete: true })] });
    const open = heat(2, { label: 'Heat 2', orderIndex: 1, races: [race(2, { name: 'Bending' })] });
    mount(competition({ teams, sessions: [session(1, { status: 1, heats: [done, open] })] }));
    expect(screen.getByRole('region', { name: 'Scoring Bending' })).toBeInTheDocument();
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
    expect(screen.getByRole('region', { name: 'Scoring Bending' })).toBeInTheDocument();
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
      await userEvent.click(screen.getByRole('button', { name: /^Rider 3, lane/ }));
      await waitFor(() => expect(badge('Rider 3')).toBeNull());
      expect(badge('Rider 1')).toHaveTextContent('1');
      expect(badge('Rider 2')).toHaveTextContent('2');
    });

    it('does not place the last team by itself', async () => {
      mount(scoringData(3));
      await tapRider('Rider 1', 1);
      await tapRider('Rider 2', 2);
      expect(badge('Rider 3')).toBeNull();
      expect(placed()).toBe(2);
    });

    it('keeps every row where it was while teams are placed', async () => {
      mount(scoringData(3));
      const order = () => within(screen.getByRole('region', { name: 'Scoring Bending' })).getAllByRole('listitem').map((li) => /Rider \d/.exec(li.textContent ?? '')?.[0]);
      expect(order()).toEqual(['Rider 1', 'Rider 2', 'Rider 3']);
      await tapRider('Rider 3', 1);
      await tapRider('Rider 1', 2);
      expect(order()).toEqual(['Rider 1', 'Rider 2', 'Rider 3']);
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
      expect(placed()).toBe(2);
    });

    it('leaves a draft for a different race alone until that race is opened', async () => {
      keepDraft(2, [{ teamId: 2, place: 1, eliminated: false }]);
      mount(scoringData(3));
      await opened('Bending');
      expect(badge('Rider 2')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: /^2\. Flag/ }));
      await waitFor(() => expect(badge('Rider 2')).toHaveTextContent('1'));
    });

    it('prefers the draft to the saved results of a finished race', async () => {
      keepDraft(1, [{ teamId: 3, place: 1, eliminated: false }]);
      mount(withFinishedRace());
      await userEvent.click(screen.getByRole('button', { name: /^1\. Bending/ }));
      await waitFor(() => expect(badge('Rider 3')).toHaveTextContent('1'));
      expect(badge('Rider 1')).toBeNull();
    });

    it('shows the saved results of a finished race when there is no draft, without keeping them as a draft', async () => {
      mount(withFinishedRace());
      await userEvent.click(screen.getByRole('button', { name: /^1\. Bending/ }));
      await waitFor(() => expect(badge('Rider 3')).toHaveTextContent('2'));
      expect(badge('Rider 1')).toHaveTextContent('1');
      expect(localStorage.getItem(draftKey(1))).toBeNull();
    });

    it('saves what is entered, and drops the draft once the race is saved', async () => {
      mount(scoringData(2));
      await tapRider('Rider 2', 1);
      await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey(1))!)).toEqual([{ teamId: 2, place: 1, eliminated: false }]));
      await tapRider('Rider 1', 2);
      await completeRace();
      await opened('Flag');
      expect(localStorage.getItem(draftKey(1))).toBeNull();
    });

    it('ignores a damaged draft', async () => {
      localStorage.setItem(draftKey(1), '{oops');
      mount(scoringData(2));
      await opened('Bending');
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
      await completeRace();
    };

    it('runs through one heat before starting the next', async () => {
      mount(twoHeats(false));
      await opened('H1 R1');
      await saveRace();
      await opened('H1 R2');
      await saveRace();
      await opened('H2 R1');
    }, 60_000);

    it('goes across the heats for each race when the session alternates', async () => {
      mount(twoHeats(true));
      await opened('H1 R1');
      await saveRace();
      await opened('H2 R1');
      await saveRace();
      await opened('H1 R2');
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
      expect(screen.getByRole('button', { name: /^Team 4, lane S/ })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: /^Team 4, lane S/ }));
      expect(placed()).toBe(0);
    });

    it('sends the sitting-out team with no place when the race is saved', async () => {
      mount(sevenFour());
      await screen.findByTitle('Lane S');
      for (const [i, name] of ['Team 1', 'Team 2', 'Team 3'].entries()) await tapRider(name, i + 1);
      await completeRace();
      expect(outbox()[0].places).toEqual([
        { teamId: 1, place: 1, eliminated: false },
        { teamId: 2, place: 2, eliminated: false },
        { teamId: 3, place: 3, eliminated: false },
        { teamId: 4, place: 0, eliminated: false },
      ]);
    });
  });

  describe('why a team is out, and the elimination sheet', () => {
    it('keeps the one-tap flow: a tap places a team and nothing else opens', async () => {
      mount(scoringData(3));
      await opened('Bending');
      await tapRider('Rider 1', 1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^More/ })).not.toBeInTheDocument();
    });

    it('asks why when the race is marked complete, and sends a did-not-start with its reason', async () => {
      mount(scoringData(3));
      await opened('Bending');
      await tapRider('Rider 1', 1);
      await userEvent.click(screen.getByRole('button', { name: 'Eliminate Rider 3' }));
      await completeRace();
      const sheet = screen.getByRole('dialog', { name: 'Why were teams eliminated?' });
      expect(within(sheet).getByText('Rider 3')).toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Did not start' }));
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save race' }));
      expect(outbox()[0].places).toEqual([
        { teamId: 1, place: 1, eliminated: false },
        { teamId: 3, place: 0, eliminated: true, status: 2, refereeNote: 'Did not start' },
      ]);
    });

    it('lets the reasons be skipped', async () => {
      mount(scoringData(3));
      await opened('Bending');
      await tapRider('Rider 1', 1);
      await userEvent.click(screen.getByRole('button', { name: 'Eliminate Rider 2' }));
      await completeRace();
      await userEvent.click(screen.getByRole('button', { name: 'Save without reasons' }));
      expect(outbox()[0].places).toEqual([{ teamId: 1, place: 1, eliminated: false }, { teamId: 2, place: 0, eliminated: true }]);
    });

    it('loads the notes staff saved when a scored race is corrected, and sends them back', async () => {
      const data = competition({
        teams,
        sessions: [session(1, { status: 1, heats: [heat(1, {
          entries: entries(2),
          races: [race(1, { name: 'Bending', isComplete: true, results: [result(1, 1, { points: 2 }), result(2, null, { eliminated: true, status: 3 })] })],
        })] })],
      });
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/races/1/score') return Promise.resolve({ data: { raceId: 1, revision: 1, isSignedOff: false, results: [
          { teamId: 1, place: 1, eliminated: false, points: 2, refereeNote: 'Quick start' },
          { teamId: 2, place: 0, eliminated: true, points: 0, status: 3, refereeNote: null },
        ] } });
        if (String(url).endsWith('/scorer-links')) return Promise.resolve({ data: emptyScorerLinks });
        return Promise.resolve({ data: [] });
      });
      render(
        <MemoryRouter initialEntries={['/competitions/1/session/1']}>
          <CompetitionContext.Provider value={{ competition: data, reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [] }}>
            <Routes><Route path="/competitions/:id/session/:sessionId" element={<SessionPage />} /></Routes>
          </CompetitionContext.Provider>
        </MemoryRouter>,
      );
      await userEvent.click(await screen.findByRole('button', { name: /^1\. Bending/ }));
      await opened('Bending');
      await userEvent.type(screen.getByLabelText('Reason for correction'), 'Judge changed it');
      await waitFor(() => expect(within(row('Rider 2')).getByLabelText('Did not finish')).toBeInTheDocument());
      await completeRace();
      // Rider 2 is out for not finishing, so the sheet starts on that reason.
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save race' }));
      expect(outbox()[0].places).toEqual([
        { teamId: 1, place: 1, eliminated: false, refereeNote: 'Quick start' },
        { teamId: 2, place: 0, eliminated: true, status: 3, refereeNote: 'Did not finish' },
      ]);
    });
  });

  describe('undo', () => {
    it('takes back the last tap, one at a time', async () => {
      mount(scoringData(3));
      await opened('Bending');
      expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled();
      await tapRider('Rider 1', 1);
      await tapRider('Rider 2', 2);
      await userEvent.click(screen.getByRole('button', { name: /Undo/ }));
      await waitFor(() => expect(placed()).toBe(1));
      expect(badge('Rider 1')).toHaveTextContent('1');
      await userEvent.click(screen.getByRole('button', { name: /Undo/ }));
      await waitFor(() => expect(placed()).toBe(0));
      expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled();
    });

    it('takes back a Clear', async () => {
      mount(scoringData(3));
      await opened('Bending');
      await tapRider('Rider 1', 1);
      await userEvent.click(screen.getByRole('button', { name: /Clear/ }));
      expect(placed()).toBe(0);
      await userEvent.click(screen.getByRole('button', { name: /Undo/ }));
      await waitFor(() => expect(placed()).toBe(1));
    });

    it('cancels a save that is still waiting in the outbox, and puts the placings back on screen', async () => {
      mount(scoringData(2));
      await opened('Bending');
      await tapRider('Rider 2', 1);
      await tapRider('Rider 1', 2);
      await completeRace();
      await opened('Flag');
      expect(outbox()).toHaveLength(1);
      await userEvent.click(screen.getByRole('button', { name: 'Undo last save' }));
      await opened('Bending');
      expect(outbox()).toHaveLength(0);
      await waitFor(() => expect(placed()).toBe(2));
      expect(badge('Rider 2')).toHaveTextContent('1');
    });

    it('sends a correction once the save has gone through', async () => {
      // The race already has results, so the new save is a correction that replaces them.
      const earlier = race(1, { name: 'Bending', isComplete: true, results: [result(1, 1, { points: 2 }), result(2, 2, { points: 1 })] });
      mount(competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { entries: entries(2), races: [earlier, race(2, { name: 'Flag' })] })] })] }));
      await userEvent.click(await screen.findByRole('button', { name: /^1\. Bending/ }));
      await userEvent.type(await screen.findByLabelText('Reason for correction'), 'Wrong order');
      await userEvent.click(screen.getByRole('button', { name: /Clear/ }));
      await tapRider('Rider 2', 1);
      await tapRider('Rider 1', 2);
      await completeRace();
      expect(outbox()[0].reason).toBe('Wrong order');
      // The server took the save, so the outbox is empty. Undo sends the earlier results back as a correction.
      localStorage.removeItem('mg.outbox.scores');
      window.dispatchEvent(new CustomEvent('mg:outbox'));
      await userEvent.click(await screen.findByRole('button', { name: 'Undo last save' }));
      await waitFor(() => expect(outbox()).toHaveLength(1));
      expect(outbox()[0].reason).toMatch(/^Undo/);
      expect(outbox()[0].places).toEqual([{ teamId: 1, place: 1, eliminated: false }, { teamId: 2, place: 2, eliminated: false }]);
    });
  });

  describe('hors concours', () => {
    it('asks first, then marks the team through the same call Teams uses', async () => {
      vi.mocked(api.put).mockResolvedValue({ data: {} });
      const reload = vi.fn();
      mount(scoringData(3), [], reload);
      await opened('Bending');
      await userEvent.click(screen.getByRole('button', { name: 'Mark Rider 2 hors concours' }));
      expect(api.put).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toHaveTextContent('Competes but doesn’t score; removed from standings and finals seeding.');
      await userEvent.click(screen.getByRole('button', { name: 'Make HC' }));
      expect(api.put).toHaveBeenCalledWith('/competitions/1/teams/2', { isHorsConcours: true });
      await waitFor(() => expect(reload).toHaveBeenCalled());
    });

    it('tags a team that is already HC, and can bring it back', async () => {
      vi.mocked(api.put).mockResolvedValue({ data: {} });
      mount(competition({ teams: [team(1, { displayName: 'Oak A', isHorsConcours: true })], sessions: scoringData(2).sessions }));
      await opened('Bending');
      expect(within(row('Rider 1')).getByText('HC', { selector: 'span' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Bring Rider 1 back into scoring' }));
      await userEvent.click(screen.getByRole('button', { name: 'Bring back' }));
      expect(api.put).toHaveBeenCalledWith('/competitions/1/teams/1', { isHorsConcours: false });
    });

    it('says so when the change could not be saved', async () => {
      vi.mocked(api.put).mockRejectedValue(new Error('no'));
      mount(scoringData(3));
      await opened('Bending');
      await userEvent.click(screen.getByRole('button', { name: 'Mark Rider 2 hors concours' }));
      await userEvent.click(screen.getByRole('button', { name: 'Make HC' }));
      expect(await screen.findByText('Couldn’t change hors concours. Try again.')).toBeInTheDocument();
    });
  });

  describe('the scoring page layout', () => {
    it('has no back arrow, Rules or Set up heats in a header, and keeps the organiser tools together', async () => {
      mount(scoringData());
      expect(screen.queryByRole('link', { name: /Sessions/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Rules/ })).not.toBeInTheDocument();
      const details = screen.getByText('Organiser tools').closest('details')!;
      expect(within(details).getByRole('button', { name: /Set up heats/ })).toBeInTheDocument();
      expect(within(details).getByRole('region', { name: 'Scorer links' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Race rules' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Race rules and arena setup' }));
      expect(screen.getByRole('region', { name: 'Race rules' })).toBeInTheDocument();
    });

    it('stacks the races: the current one open, the rest as lines, with the announcer card after the finished one', async () => {
      const finished = race(1, { name: 'Bending', isComplete: true, results: [result(2, 1, { points: 3 }), result(1, 2, { points: 2 }), result(3, 3, { points: 1 })] });
      mount(competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { entries: entries(3), races: [finished, race(2, { name: 'Flag' }), race(3, { name: 'Mug' })] })] })] }));
      await opened('Flag');
      expect(screen.getByRole('button', { name: /^1\. Bending.*1st Rider 2/ })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Mug, coming up' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Announcer summary for Bending' })).toHaveTextContent('1st Rider 2, 3 points');
    });

    it('shows a race saved on the phone as done, with its summary, before it has been sent', async () => {
      mount(scoringData(2));
      await opened('Bending');
      await tapRider('Rider 2', 1);
      await tapRider('Rider 1', 2);
      await completeRace();
      await opened('Flag');
      expect(screen.getByRole('region', { name: 'Announcer summary for Bending' })).toHaveTextContent('1st Rider 2, 2 points');
      expect(screen.getByRole('button', { name: /^1\. Bending.*Not sent/ })).toBeInTheDocument();
    });

    it('shows the lanes of the final provisionally once both qualifiers are in, and not again once the final is filled', async () => {
      const qualifier = (id: number, order: number, names: string[]) => heat(id, {
        orderIndex: order, raceRoundId: 5, raceRoundStage: 1, label: `Q${order}`,
        entries: names.map((n, i) => ({ id: id * 10 + i, teamId: id * 10 + i, teamName: n, laneIndex: i + 1 })),
        races: [race(id, { name: `Qualifier ${order}`, isComplete: true, results: names.map((_, i) => result(id * 10 + i, i + 1, { points: 1 })) })],
      });
      const data = (finalEntries: HeatEntry[]) => competition({
        teams, sessions: [session(1, { status: 1, qualifiersPerHeat: 2, lanesPerHeat: 4, heats: [
          qualifier(1, 1, ['A1', 'A2', 'A3']), qualifier(2, 2, ['B1', 'B2', 'B3']),
          heat(3, { orderIndex: 3, raceRoundId: 5, raceRoundStage: 2, label: 'Final', entries: finalEntries, races: [race(30, { name: 'Final race' })] }),
        ] })],
      });
      const view = mount(data([]));
      expect(await screen.findByRole('region', { name: 'Lanes for Final' }, { timeout: 5000 })).toHaveTextContent('Provisional');
      expect(screen.getByRole('region', { name: 'Lanes for Final' })).toHaveTextContent('A1');
      view.unmount();
      mount(data([{ id: 99, teamId: 21, teamName: 'B1', laneIndex: 1 }]));
      // Once the final has its teams its own rows show the lanes, so no second list.
      await opened('Final race');
      expect(screen.queryByRole('region', { name: 'Lanes for Final' })).not.toBeInTheDocument();
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
      expect(await screen.findByText(/The first 2 home go through/)).toBeInTheDocument();
      await tapRider('Team 1', 1);
      await tapRider('Team 2', 2);
      // The qualifying places are taken, so a tap on another team eliminates it.
      for (let attempt = 0; attempt < 4 && !within(row('Team 3')).queryByLabelText('Eliminated'); attempt++) {
        await userEvent.click(screen.getByRole('button', { name: /^Team 3, lane/ }));
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(within(row('Team 3')).getByLabelText('Eliminated')).toBeInTheDocument();
      await completeRace();
      await userEvent.click(screen.getByRole('button', { name: 'Save without reasons' }));
      // Team 4 was never tapped: it finishes after the qualifiers, on the qualifier's one point.
      expect(outbox()[0].places).toEqual([
        { teamId: 1, place: 1, eliminated: false },
        { teamId: 2, place: 2, eliminated: false },
        { teamId: 3, place: 0, eliminated: true },
        { teamId: 4, place: 3, eliminated: false },
      ]);
    });

    it('does not ask for qualifiers in the final', async () => {
      mount(round(2));
      await opened('Bending');
      expect(screen.queryByText(/home go through/)).not.toBeInTheDocument();
    });
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

  describe('Run-off tie-breaker, manual score override, and team point adjustments', () => {
    it('hides .01 run-off tie-breaker fractions while keeping .5 half-points visible', () => {
      expect(formatPoints(24)).toBe('24');
      expect(formatPoints(24.01)).toBe('24');
      expect(formatPoints(24.5)).toBe('24.5');
      expect(formatPoints(24.51)).toBe('24.5');
    });

    it('awards +0.01 to the run-off winner and supports manual score override and team point adjustments', async () => {
      const tiedComp = competition({
        teams,
        sessions: [session(1, {
          status: 1,
          heats: [heat(1, {
            entries: entries(2),
            races: [race(1, {
              name: 'Bending',
              isComplete: true,
              results: [result(1, 1, { points: 5 }), result(2, 1, { points: 5 })],
            })],
          })],
        })],
      });
      mount(tiedComp);
      await screen.findByText('Organiser tools');

      await userEvent.selectOptions(screen.getByLabelText('Run-off winner'), '2');
      await userEvent.click(screen.getByRole('button', { name: 'Record run-off winner' }));
      expect(await screen.findByTestId('runoff-standing-1')).toHaveTextContent('1. Rider 2: 5 pts');
      expect(screen.getByTestId('runoff-standing-2')).toHaveTextContent('2. Rider 1: 5 pts');

      const customPts = screen.getByLabelText('Custom points');
      await userEvent.clear(customPts);
      await userEvent.type(customPts, '4.5');
      await userEvent.type(screen.getByLabelText('Override reason'), 'Dead heat');
      await userEvent.click(screen.getByRole('button', { name: 'Save override' }));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/races/1/results', expect.objectContaining({
        reason: 'Dead heat',
        places: expect.arrayContaining([
          expect.objectContaining({ teamId: 1, refereeNote: '[pts:4.5] Dead heat' }),
        ]),
      })));

      await userEvent.type(screen.getByLabelText('Adjustment reason'), 'False start penalty');
      await userEvent.click(screen.getByRole('button', { name: 'Apply adjustment' }));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/races/1/results', expect.objectContaining({
        reason: 'False start penalty',
        places: expect.arrayContaining([
          expect.objectContaining({ teamId: 1, refereeNote: '[adj:-1] False start penalty' }),
        ]),
      })));
    });

    it('accepts only whole or half points, and says when a run-off result could not be saved', async () => {
      const tiedComp = competition({
        teams,
        sessions: [session(1, {
          status: 1,
          heats: [heat(1, {
            entries: entries(2),
            races: [race(1, {
              name: 'Bending',
              isComplete: true,
              results: [result(1, 1, { points: 5 }), result(2, 1, { points: 5 })],
            })],
          })],
        })],
      });
      vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
      mount(tiedComp);
      await screen.findByText('Organiser tools');

      await userEvent.click(screen.getByRole('button', { name: 'Record run-off winner' }));
      expect(await screen.findByText('Couldn’t save the run-off result. Try again.')).toBeInTheDocument();

      const customPts = screen.getByLabelText('Custom points');
      await userEvent.clear(customPts);
      await userEvent.type(customPts, '2.25');
      await userEvent.click(screen.getByRole('button', { name: 'Save override' }));
      expect(await screen.findByText('Enter whole or half points, such as 3 or 2.5.')).toBeInTheDocument();

      const delta = screen.getByLabelText('Point adjustment');
      await userEvent.clear(delta);
      await userEvent.type(delta, '0.3');
      await userEvent.type(screen.getByLabelText('Adjustment reason'), 'Typo');
      await userEvent.click(screen.getByRole('button', { name: 'Apply adjustment' }));
      expect(await screen.findByText('Adjust by whole or half points, such as 1 or -0.5.')).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();
    });

    it('supports 1-tap short-handed HC, Under Review flag, Clear / Re-run race, and mid-session Change / Cancel race with announcement', async () => {
      vi.mocked(api.put).mockResolvedValue({ data: {} });
      vi.mocked(api.post).mockResolvedValue({ data: {} });
      vi.mocked(api.delete).mockResolvedValue({ data: {} });

      mount(scoringData(2));
      await screen.findByText('Organiser tools');

      await userEvent.selectOptions(screen.getByLabelText('Short-handed team'), '2');
      await userEvent.click(screen.getByRole('button', { name: 'Mark team HC (Hors Concours)' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/teams/2', { isHorsConcours: true }));

      await userEvent.selectOptions(screen.getByLabelText('Under review team'), '2');
      await userEvent.type(screen.getByLabelText('Under review note'), 'Lane interference');
      await userEvent.click(screen.getByRole('button', { name: 'Flag Under Review' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/sessions/races/1/results/2/under-review', {
        underReview: true,
        note: 'Lane interference',
      }));
      expect(await screen.findByTestId('under-review-badge-2')).toHaveTextContent('UNDER REVIEW: Rider 2');

      await userEvent.click(screen.getByRole('button', { name: 'Re-run stopped race' }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/sessions/races/1/results'));

      await userEvent.type(screen.getByLabelText('New race name'), 'Sword');
      await userEvent.click(screen.getByRole('button', { name: 'Change race' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/sessions/1/races/1', {
        newName: 'Sword',
        applyToAllHeats: true,
      }));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/chat', {
        body: 'Update: Race 1 in Session 1 is now Sword',
        type: 1,
      }));

      await userEvent.click(screen.getByRole('button', { name: 'Cancel race' }));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/1/sessions/1/races/1'));
    });
  });
});
