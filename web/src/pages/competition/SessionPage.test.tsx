import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import type { HeatEntry } from '../../types';
import type { CompetitionDetail, Session, DeclarationForm, StandingRow } from '../../types';
import { CompetitionContext } from './context';
import { SessionPage } from './SessionPage';
import { formatPoints } from '../../lib/formatPoints';
import { autoConfirm } from '../../test/confirm';

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

const saveOverlay = vi.fn().mockResolvedValue('saved');
const emptyScorerLinks = { arenas: ['Main arena', 'All arenas'], defaultExpiresAt: '2026-11-02T00:00:00Z', links: [] };

function mount(data: CompetitionDetail, forms: DeclarationForm[] = [], reload = vi.fn(), officialRows: StandingRow[] = [standing(1, 12, { teamName: 'Oak A', bonusPoints: 10 }), standing(2, 1, { teamName: 'Beech B' })]) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.endsWith('/standings')) return Promise.resolve({ data: officialRows });
    if (url === '/declaration-forms') return Promise.resolve({ data: forms });
    if (String(url).endsWith('/scorer-links')) return Promise.resolve({ data: emptyScorerLinks });
    return Promise.resolve({ data: [] });
  });
  return render(
    <MemoryRouter initialEntries={['/competitions/1/session/1']}>
      <CompetitionContext.Provider value={{
        competition: data, reload, saveOverlay, streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [],
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
const completeRace = () => userEvent.click(screen.getByRole('button', { name: 'SAVE SCORES' }));
const openTools = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Race tools' }));
  return screen.getByRole('dialog', { name: 'Race tools' });
};
const openOrganiserTools = async () => {
  const sheet = await openTools();
  await userEvent.click(within(sheet).getByRole('button', { name: /Organiser tools/ }));
  return screen.getByRole('dialog', { name: 'Organiser tools' });
};
const openInfo = async (link: RegExp, dialog: string) => {
  const sheet = await openTools();
  await userEvent.click(within(sheet).getByRole('button', { name: link }));
  return screen.getByRole('dialog', { name: dialog });
};
const teamMenu = async (sheet: HTMLElement, name: string) => {
  await userEvent.click(within(sheet).getByRole('button', { name: `More for ${name}` }));
  return within(sheet).getByRole('menu', { name });
};
const outbox = () => JSON.parse(localStorage.getItem('mg.outbox.scores') ?? '[]') as { raceId: number; reason?: string; places: { teamId: number; place: number; eliminated: boolean; status?: number; refereeNote?: string }[] }[];

const teams = [team(1, { displayName: 'Oak A' }), team(2, { displayName: 'Beech B' }), team(3, { displayName: 'Ash C' })];

describe('SessionPage', () => {
  beforeEach(() => { saveOverlay.mockResolvedValue('saved'); auth.manage = true; vi.mocked(api.get).mockResolvedValue({ data: [] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('imports a backup using staff credentials despite a stored scorer link', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    localStorage.setItem('mg.scorer.token', 'synthetic-old-scorer-token');
    mount(scoringData());
    await opened('Bending');
    const tools = await openOrganiserTools();
    await userEvent.click(within(tools).getByText('Import scores from another phone'));
    fireEvent.change(screen.getByLabelText('Backup'), { target: { value: JSON.stringify([{
      raceId: 1, competitionId: 1, sessionId: 1, label: 'Synthetic race',
      places: [{ teamId: 1, place: 1, eliminated: false }], expected: [], teamNames: { 1: 'Synthetic Team' },
      queuedAt: '2026-06-01T10:00:00Z', state: 'waiting', viaLink: true,
    }]) } });
    await userEvent.click(screen.getByRole('button', { name: 'Add scores' }));

    expect(outbox()).toEqual([expect.objectContaining({ raceId: 1 })]);
    expect(outbox()[0]).not.toHaveProperty('viaLink', true);
  });

  describe('who may score', () => {
    const open = () => competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { races: [race(1, { name: 'Bending' })] })] })] });

    it('shows the scoring view, the organiser tools, and no score record or sign-off, to someone who can manage this competition', async () => {
      mount(open());
      expect(screen.getByRole('region', { name: 'Scoring Bending' })).toBeInTheDocument();
      // The organiser tools are no longer a panel under the race: they open from Race tools.
      expect(screen.queryByRole('button', { name: /Set up heats/ })).not.toBeInTheDocument();
      const tools = await openOrganiserTools();
      expect(within(tools).getByRole('button', { name: /Set up heats/ })).toBeInTheDocument();
      expect(screen.queryByText('Score history')).not.toBeInTheDocument();
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

  it('shows a break’s notes without the internal tags', () => {
    mount(competition({ teams, sessions: [session(1, { kind: 1, isBreak: true, name: 'Lunch', notes: 'Burgers by the lorry park [paused:2026-06-01T12:00:00Z] [gate:12:4=at-gate] [pts:6]', heats: [] })] }));
    expect(screen.getByText('Burgers by the lorry park')).toBeInTheDocument();
    expect(screen.queryByText(/\[gate:/)).not.toBeInTheDocument();
  });

  describe('results status', () => {
    const finished = (extra: Partial<Session> = {}) => competition({ teams, sessions: [session(1, {
      status: 2, finishedAt: new Date(Date.now() - 60_000).toISOString(), heats: [heat(1, { races: [race(1, { isComplete: true })] })], ...extra,
    })] });

    it('keeps the Confirm official button for staff but shows no results badge', async () => {
      const reload = vi.fn();
      vi.mocked(api.post).mockResolvedValue({ data: {} });
      mount(finished({ provisionalUntil: new Date(Date.now() + 10 * 60_000).toISOString() }), [], reload);
      expect(screen.queryByRole('status', { name: /Results provisional/ })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Confirm official now' }));
      expect(api.post).toHaveBeenCalledWith('/competitions/1/sessions/1/confirm-official', {});
      await waitFor(() => expect(reload).toHaveBeenCalled());
    });

    it('does not show the Official mark once confirmed, nor anything while the session runs', () => {
      const { unmount } = mount(finished({ officialConfirmedAt: new Date().toISOString(), provisionalUntil: new Date().toISOString() }));
      expect(screen.queryByRole('status', { name: 'Results official' })).not.toBeInTheDocument();
      unmount();
      mount(competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { races: [race(1, { name: 'Bending' })] })] })] }));
      expect(screen.queryByLabelText('Results status')).not.toBeInTheDocument();
    });
  });

  it('links the arena crew sheet from race tools and puts the duty board in the organiser tools', async () => {
    mount(competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { races: [race(1, { name: 'Bending' })] })] })] }));
    await opened('Bending');
    const sheet = await openTools();
    expect(within(sheet).getByText('Arena crew sheet')).toBeInTheDocument();
    expect(within(sheet).getByText('Props to bring in, clear and keep')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: /Organiser tools/ }));
    const tools = screen.getByRole('dialog', { name: 'Organiser tools' });
    expect(await within(tools).findByText(/No duties are set for/)).toBeInTheDocument();
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
      await userEvent.click(screen.getByRole('button', { name: 'Next race' }));
      await waitFor(() => expect(badge('Rider 2')).toHaveTextContent('1'));
    });

    it('prefers the draft to the saved results of a finished race', async () => {
      keepDraft(1, [{ teamId: 3, place: 1, eliminated: false }]);
      mount(withFinishedRace());
      await userEvent.click(screen.getByRole('button', { name: 'Previous race' }));
      await waitFor(() => expect(badge('Rider 3')).toHaveTextContent('1'));
      expect(badge('Rider 1')).toBeNull();
    });

    it('shows the saved results of a finished race when there is no draft, without keeping them as a draft', async () => {
      mount(withFinishedRace());
      await userEvent.click(screen.getByRole('button', { name: 'Previous race' }));
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
      // The heat is done, so the page for the next heat comes up before its first race.
      await userEvent.click(await screen.findByRole('button', { name: 'Start scoring Heat 2' }));
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
      fireEvent.keyDown(screen.getByRole('button', { name: /^Rider 3, lane/ }), { key: 'Delete' });
      await tapRider('Rider 2', 2);
      await completeRace();
      const sheet = screen.getByRole('dialog', { name: 'Why were teams eliminated?' });
      expect(within(sheet).getByText('Rider 3')).toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Did not start' }));
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save race' }));
      expect(outbox()[0].places).toEqual([
        { teamId: 1, place: 1, eliminated: false },
        { teamId: 3, place: 0, eliminated: true, status: 2, refereeNote: 'Did not start' },
        { teamId: 2, place: 2, eliminated: false },
      ]);
    });

    it('lets the reasons be skipped', async () => {
      mount(scoringData(3));
      await opened('Bending');
      await tapRider('Rider 1', 1);
      fireEvent.keyDown(screen.getByRole('button', { name: /^Rider 2, lane/ }), { key: 'Delete' });
      await tapRider('Rider 3', 2);
      await completeRace();
      await userEvent.click(screen.getByRole('button', { name: 'Save without reasons' }));
      expect(outbox()[0].places).toEqual([{ teamId: 1, place: 1, eliminated: false }, { teamId: 2, place: 0, eliminated: true }, { teamId: 3, place: 2, eliminated: false }]);
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
      await opened('Bending');
      await waitFor(() => expect(within(row('Rider 2')).getByLabelText('Did not finish')).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: 'Edit this race' }));
      await userEvent.type(screen.getByLabelText('Reason for correction'), 'Judge changed it');
      await completeRace();
      // Rider 2 is out for not finishing, so the sheet starts on that reason.
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Why were teams eliminated?' })).getByRole('button', { name: 'Save race' }));
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
      await userEvent.click(await screen.findByRole('button', { name: 'Previous race' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Edit this race' }));
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
    it('marks a team hors concours from its menu in race tools, and Undo puts it back', async () => {
      vi.mocked(api.put).mockResolvedValue({ data: {} });
      const reload = vi.fn();
      mount(scoringData(3), [], reload);
      await opened('Bending');
      const sheet = await openTools();
      await userEvent.click(within(await teamMenu(sheet, 'Rider 2')).getByRole('menuitem', { name: 'Make HC' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/teams/2', { isHorsConcours: true }));
      await waitFor(() => expect(reload).toHaveBeenCalled());
      await userEvent.click(screen.getByRole('button', { name: 'Close race tools' }));
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/1/teams/2', { isHorsConcours: false }));
    });

    it('tags a team that is already HC, and can bring it back', async () => {
      vi.mocked(api.put).mockResolvedValue({ data: {} });
      mount(competition({ teams: [team(1, { displayName: 'Oak A', isHorsConcours: true })], sessions: scoringData(2).sessions }));
      await opened('Bending');
      expect(within(row('Rider 1')).getByText('HC', { selector: 'span' })).toBeInTheDocument();
      const sheet = await openTools();
      await userEvent.click(within(await teamMenu(sheet, 'Rider 1')).getByRole('menuitem', { name: 'Remove HC' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/teams/1', { isHorsConcours: false }));
    });

    it('says so when the change could not be saved', async () => {
      vi.mocked(api.put).mockRejectedValue(new Error('no'));
      mount(scoringData(3));
      await opened('Bending');
      const sheet = await openTools();
      await userEvent.click(within(await teamMenu(sheet, 'Rider 2')).getByRole('menuitem', { name: 'Make HC' }));
      expect(await screen.findByText('Couldn’t change hors concours. Check your signal and try again.')).toBeInTheDocument();
    });
  });

  describe('cards', () => {
    it('gives a yellow card at once, keeps it on the server, and Undo takes it off', async () => {
      vi.mocked(api.put).mockResolvedValue({ data: {} });
      const reload = vi.fn();
      mount(scoringData(3), [], reload);
      await opened('Bending');
      let sheet = await openTools();
      await userEvent.click(within(await teamMenu(sheet, 'Rider 2')).getByRole('menuitem', { name: 'Yellow card' }));
      expect(within(row('Rider 2')).getByRole('img', { name: 'Yellow card' })).toBeInTheDocument();
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/teams/2/card', { card: 'yellow' }));
      await waitFor(() => expect(reload).toHaveBeenCalled());

      sheet = screen.getByRole('dialog', { name: 'Race tools' });
      await userEvent.click(within(await teamMenu(sheet, 'Rider 2')).getByRole('menuitem', { name: 'Second yellow (red card)' }));
      await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/1/teams/2/card', { card: 'red' }));
      expect(within(row('Rider 2')).getByRole('img', { name: 'Red card' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Close race tools' }));
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/1/teams/2/card', { card: 'yellow' }));
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/1/teams/2/card', { card: 'none' }));
      await waitFor(() => expect(within(row('Rider 2')).queryByRole('img', { name: /card/ })).toBeNull());
    });

    it('shows a card the server already holds, and puts it back if the change fails', async () => {
      vi.mocked(api.put).mockRejectedValue(new Error('offline'));
      const data = scoringData(3);
      data.sessions[0].heats[0].entries[0] = { ...data.sessions[0].heats[0].entries[0], refereeCard: 'red' };
      mount(data);
      await opened('Bending');
      expect(within(row('Rider 1')).getByRole('img', { name: 'Red card' })).toBeInTheDocument();
      const sheet = await openTools();
      await userEvent.click(within(await teamMenu(sheet, 'Rider 1')).getByRole('menuitem', { name: 'Remove red card' }));
      expect(await screen.findByText('Couldn’t change the card. Check your signal and try again.')).toBeInTheDocument();
      expect(within(row('Rider 1')).getByRole('img', { name: 'Red card' })).toBeInTheDocument();
    });
  });

  describe('changing points', () => {
    it('moves a team’s points by hand from race tools, and Undo takes the change back', async () => {
      mount(scoringData(3));
      await opened('Bending');
      await tapRider('Rider 1', 1);
      const sheet = await openTools();
      await userEvent.click(within(await teamMenu(sheet, 'Rider 1')).getByRole('menuitem', { name: 'Change points' }));
      await userEvent.click(within(sheet).getByRole('button', { name: 'One point fewer for Rider 1' }));
      expect(within(sheet).getByText('2')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Close race tools' }));
      expect(row('Rider 1')).toHaveTextContent('2 pts by hand');
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(row('Rider 1')).not.toHaveTextContent('by hand'));
    });
  });

  describe('the heat picker and the pages around it', () => {
    const two = (n: number) => entries(n).map((e) => ({ ...e }));
    const day = (extra: { finishFirst?: boolean } = {}) => competition({
      teams,
      laneHatbands: ['Red', 'White'],
      sessions: [
        session(1, {
          status: 1, name: 'Under 12', sectionName: 'Under 12', orderIndex: 1, scheduledStart: '2026-06-01T10:00:00Z', heats: [
            heat(1, { label: 'Heat 1', orderIndex: 1, entries: two(2), races: [race(11, { name: 'Bending', orderIndex: 1, isComplete: extra.finishFirst ?? false, results: extra.finishFirst ? [result(1, 1, { points: 2 }), result(2, 2, { points: 1 })] : [] })] }),
            heat(2, { label: 'Heat 2', orderIndex: 2, sessionId: 1, entries: [{ id: 21, teamId: 3, teamName: 'Rider 3', laneIndex: 1 }, { id: 22, teamId: 4, teamName: 'Rider 4', laneIndex: 2 }], races: [race(21, { name: 'Flag', heatId: 2, orderIndex: 1 })] }),
          ],
        }),
        session(2, {
          status: 0, name: 'Pairs', sectionName: 'Pairs', orderIndex: 2, arenaName: 'Second Arena', heats: [
            heat(3, { label: 'Heat 1', sessionId: 2, orderIndex: 1, entries: [{ id: 31, teamId: 5, teamName: 'Pair 5', laneIndex: 1 }], races: [race(31, { name: 'Mug', heatId: 3 })] }),
          ],
        }),
      ],
    });
    const decForms: DeclarationForm[] = [
      { ...form(3), riders: [
        { id: 301, fullName: 'Ella Rider', horseName: 'Biscuit', isCaptain: false, isReserve: false, orderIndex: 1, flags: ['No pony passport yet'] },
        { id: 302, fullName: 'Spare Rider', horseName: 'Pip', isCaptain: false, isReserve: true, orderIndex: 2 },
      ] },
    ];

    it('shows the arena in bold and the heat, and lists every heat with where it has got to', async () => {
      mount(day());
      const bar = screen.getByRole('button', { name: 'Heat: Main Arena, Under 12 · Heat 1' });
      expect(within(bar).getByText('Main Arena')).toBeInTheDocument();
      expect(bar).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(bar);
      const list = screen.getByRole('listbox', { name: 'Heats' });
      const options = within(list).getAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual([
        expect.stringContaining('Main Arena · Under 12 · Heat 1'),
        expect.stringContaining('Main Arena · Under 12 · Heat 2'),
        expect.stringContaining('Second Arena · Pairs · Heat 1'),
        expect.stringContaining('Up next: Heat 2'),
      ]);
      expect(options[0]).toHaveTextContent('Not started');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('opens a heat that has not started as a read-only table, and scores it only after a confirm', async () => {
      const confirm = autoConfirm(true);
      mount(day());
      await userEvent.click(screen.getByRole('button', { name: /^Heat:/ }));
      await userEvent.click(screen.getByRole('option', { name: /Main Arena · Under 12 · Heat 2/ }));
      expect(screen.queryByRole('region', { name: /^Scoring/ })).toBeNull();
      expect(screen.getByRole('heading', { name: 'Main Arena · Under 12 · Heat 2' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Heat table' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Score this heat' }));
      await opened('Flag');
      expect(confirm.titles).toEqual(['Score Heat 2 in Main Arena?']);
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Another scorer may be on it'));
    });

    it('stays on the table when the scorer says no', async () => {
      autoConfirm(false);
      mount(day());
      await userEvent.click(screen.getByRole('button', { name: /^Heat:/ }));
      await userEvent.click(screen.getByRole('option', { name: /Main Arena · Under 12 · Heat 2/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Score this heat' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(screen.getByRole('region', { name: 'Heat table' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /^Scoring/ })).toBeNull();
    });

    it('opens a heat in another arena in its own session, as a table first', async () => {
      mount(day());
      await userEvent.click(screen.getByRole('button', { name: /^Heat:/ }));
      await userEvent.click(screen.getByRole('option', { name: /Second Arena · Pairs · Heat 1/ }));
      expect(await screen.findByRole('button', { name: 'Heat: Second Arena, Pairs · Heat 1' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Heat table' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /^Scoring/ })).toBeNull();
    });

    it('lets an earlier, finished heat be opened for scoring again', async () => {
      mount(day({ finishFirst: true }));
      // Heat 1 is finished, so Heat 2 is the one on. Going back to Heat 1 opens it for correction, not a table.
      await opened('Flag');
      await userEvent.click(screen.getByRole('button', { name: /^Heat:/ }));
      expect(screen.getByRole('option', { name: /Main Arena · Under 12 · Heat 1/ })).toHaveTextContent('Finished');
      await userEvent.click(screen.getByRole('option', { name: /Main Arena · Under 12 · Heat 1/ }));
      await opened('Bending');
      expect(screen.getByText('Race 1 of 1 · Scored')).toBeInTheDocument();
    });

    it('moves to the next heat page when the last race is saved, with lanes, teams and dec forms', async () => {
      mount(day(), decForms);
      await opened('Bending');
      await tapRider('Rider 1', 1);
      await tapRider('Rider 2', 2);
      await completeRace();
      expect(await screen.findByRole('heading', { name: 'Next: Heat 2' })).toBeInTheDocument();
      expect(screen.getByText('Main Arena · Under 12 · Heat 2')).toBeInTheDocument();
      expect(screen.getByText('L1')).toBeInTheDocument();
      expect(screen.getByText('Rider 3')).toBeInTheDocument();
      expect(screen.getByText('1 flag')).toBeInTheDocument();
      expect(screen.getByText('No dec form yet')).toBeInTheDocument();
      expect(screen.queryByText('Ella Rider')).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Show dec form for Rider 3' }));
      expect(screen.getByText('Ella Rider')).toBeInTheDocument();
      expect(screen.getByText('Biscuit')).toBeInTheDocument();
      expect(screen.getByText('No pony passport yet')).toBeInTheDocument();
      expect(screen.queryByText('Spare Rider')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Hide dec form for Rider 3' }));
      expect(screen.queryByText('Ella Rider')).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Start scoring Heat 2' }));
      await opened('Flag');
    });

    it('goes back to the heat from the next heat page, and reaches it from the picker', async () => {
      mount(day(), decForms);
      await userEvent.click(screen.getByRole('button', { name: /^Heat:/ }));
      await userEvent.click(screen.getByRole('option', { name: /Up next: Heat 2/ }));
      expect(screen.getByRole('heading', { name: 'Next: Heat 2' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Back to Heat 1' }));
      await opened('Bending');
    });

    it('starts the next heat in another session by opening it', async () => {
      const data = day();
      data.sessions[1].arenaName = null;
      data.sessions[0].heats = data.sessions[0].heats.slice(0, 1);
      mount(data);
      await opened('Bending');
      await userEvent.click(screen.getByRole('button', { name: /^Heat:/ }));
      await userEvent.click(screen.getByRole('option', { name: /Up next: Heat 1/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Start scoring Heat 1' }));
      expect(await screen.findByRole('button', { name: 'Heat: Main Arena, Pairs · Heat 1' })).toBeInTheDocument();
    });
  });

  describe('the scoring page layout', () => {
    it('has no back arrow, Rules or Set up heats in a header, and keeps the organiser tools together', async () => {
      mount(scoringData());
      expect(screen.queryByRole('link', { name: /Sessions/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Rules/ })).not.toBeInTheDocument();
      // Nothing sits under the race any more: no details panel, and the tools wait in the sheet.
      expect(document.querySelector('details')).toBeNull();
      expect(screen.queryByRole('button', { name: /Set up heats/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Scorer links' })).not.toBeInTheDocument();
      const tools = await openOrganiserTools();
      expect(within(tools).getByRole('button', { name: /Set up heats/ })).toBeInTheDocument();
      expect(within(tools).getByRole('region', { name: 'Scorer links' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Race rules' })).toBeNull();
    });

    it('shows only the active race with the top race switcher and the announcer summary for the previous finished race', async () => {
      const finished = race(1, { name: 'Bending', isComplete: true, results: [result(2, 1, { points: 3 }), result(1, 2, { points: 2 }), result(3, 3, { points: 1 })] });
      mount(competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { entries: entries(3), races: [finished, race(2, { name: 'Flag' }), race(3, { name: 'Mug' })] })] })] }));
      await opened('Flag');
      expect(screen.getByRole('button', { name: 'Previous race' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next race' })).not.toBeDisabled();
      expect(screen.queryByRole('region', { name: 'Announcer summary for Bending' })).toBeNull();
      const lastRace = await openInfo(/Last race/, 'Last race');
      expect(within(lastRace).getByRole('region', { name: 'Announcer summary for Bending' })).toHaveTextContent('1st Rider 2, 3 points');
    });

    it('shows a race saved on the phone as done, with its summary, before it has been sent', async () => {
      mount(scoringData(2));
      await opened('Bending');
      await tapRider('Rider 2', 1);
      await tapRider('Rider 1', 2);
      await completeRace();
      await opened('Flag');
      const lastRace = await openInfo(/Last race/, 'Last race');
      expect(within(lastRace).getByRole('region', { name: 'Announcer summary for Bending' })).toHaveTextContent('1st Rider 2, 2 points');
      await userEvent.click(within(lastRace).getByRole('button', { name: 'Close' }));
      await userEvent.click(screen.getByRole('button', { name: 'Previous race' }));
      await opened('Bending');
      expect(screen.getByText(/Not sent yet:/)).toBeInTheDocument();
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
      await opened('Final race');
      // The provisional lanes are a link in Race tools, not a card under the race.
      expect(screen.queryByRole('region', { name: 'Lanes for Final' })).not.toBeInTheDocument();
      await waitFor(async () => {
        await userEvent.click(screen.getByRole('button', { name: 'Race tools' }));
        expect(within(screen.getByRole('dialog', { name: 'Race tools' })).getByRole('button', { name: /Lanes for Final/ })).toBeInTheDocument();
      }, { timeout: 5000 });
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Race tools' })).getByRole('button', { name: /Lanes for Final/ }));
      const lanes = screen.getByRole('dialog', { name: 'Next round lanes' });
      expect(lanes).toHaveTextContent('Provisional');
      expect(lanes).toHaveTextContent('A1');
      view.unmount();
      mount(data([{ id: 99, teamId: 21, teamName: 'B1', laneIndex: 1 }]));
      // Once the final has its teams its own rows show the lanes, so no second list.
      await opened('Final race');
      const sheet = await openTools();
      expect(within(sheet).queryByRole('button', { name: /Lanes for Final/ })).toBeNull();
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
    const data = () => competition({ teams, sessions: [session(1, { status: 0, heats: [], plannedRaces: ['Sword', 'Bank', 'Hi-Lo'] })] });

    it('starts with all active section teams selected and visible even when only some have a dec form, and pre-fills planned races', async () => {
      mount(data(), [form(1), form(2)]);
      await userEvent.click(screen.getByRole('button', { name: /Set up heats/ }));
      expect(await screen.findByText(/Teams \(3 selected\)/)).toBeInTheDocument();
      expect(screen.getByText('2 dec forms in')).toBeInTheDocument();
      expect(screen.getByLabelText(/Show teams without dec forms/)).toBeChecked();
      const racePicker = screen.getByRole('list', { name: 'Race names' });
      expect(within(racePicker).getByText('Sword')).toBeInTheDocument();
      expect(within(racePicker).getByText('Bank')).toBeInTheDocument();
      expect(within(racePicker).getByText('Hi-Lo')).toBeInTheDocument();
    });

    it('selects every team when none has a dec form', async () => {
      mount(data(), []);
      await userEvent.click(screen.getByRole('button', { name: /Set up heats/ }));
      expect(await screen.findByText(/Teams \(3 selected\)/)).toBeInTheDocument();
    });

    it('keeps the trainer own choices: None, then a single team', async () => {
      mount(data(), [form(1), form(2)]);
      await userEvent.click(screen.getByRole('button', { name: /Set up heats/ }));
      await screen.findByText(/Teams \(3 selected\)/);
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
      await openOrganiserTools();

      await userEvent.selectOptions(screen.getByLabelText('Run-off winner'), '2');
      await userEvent.click(screen.getByRole('button', { name: 'Record run-off winner' }));
      expect(await screen.findByTestId('runoff-standing-1')).toHaveTextContent('1. Rider 2: 5 pts');
      expect(screen.getByTestId('runoff-standing-2')).toHaveTextContent('2. Rider 1: 5 pts');

      const customPts = screen.getByLabelText('Custom points');
      await userEvent.clear(customPts);
      await userEvent.type(customPts, '4.5');
      await userEvent.type(screen.getByLabelText('Reason'), 'Dead heat');
      await userEvent.click(screen.getByRole('button', { name: 'Set points' }));
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
      await openOrganiserTools();

      await userEvent.click(screen.getByRole('button', { name: 'Record run-off winner' }));
      expect(await screen.findByText('Couldn’t save the run-off result. Check your signal and try again.')).toBeInTheDocument();

      const customPts = screen.getByLabelText('Custom points');
      await userEvent.clear(customPts);
      await userEvent.type(customPts, '2.25');
      await userEvent.click(screen.getByRole('button', { name: 'Set points' }));
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
      await opened('Bending');
      await openOrganiserTools();

      await userEvent.selectOptions(screen.getByLabelText('Short-handed team'), '2');
      await userEvent.click(screen.getByRole('button', { name: 'Mark team HC (Hors Concours)' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/teams/2', { isHorsConcours: true }));

      await userEvent.selectOptions(screen.getByLabelText('Under review team'), '2');
      await userEvent.type(screen.getByLabelText('Under review note'), 'Lane interference');
      await userEvent.click(screen.getByRole('button', { name: 'Flag under review' }));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/sessions/races/1/results/2/under-review', {
        underReview: true,
        note: 'Lane interference',
      }));
      expect(await screen.findByTestId('under-review-badge-2')).toHaveTextContent('UNDER REVIEW: Rider 2');

      // The sheet shows the race controls first, then the score adjustments panel; these use the adjustments panel's own.
      await userEvent.click(screen.getAllByRole('button', { name: 'Re-run stopped race' }).at(-1)!);
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/sessions/races/1/results'));

      await userEvent.selectOptions(screen.getAllByLabelText('New race name').at(-1)!, 'Sword');
      await userEvent.click(screen.getAllByRole('button', { name: 'Change race' }).at(-1)!);
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/sessions/1/races/1', {
        newName: 'Sword',
        applyToAllHeats: true,
      }));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/chat', {
        body: 'Update: Race 1 in Session 1 is now Sword',
        type: 1,
      }));

      await userEvent.click(screen.getAllByRole('button', { name: 'Cancel race' }).at(-1)!);
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/1/sessions/1/races/1'));
    });
  });
  it('sends the full programme when editing remaining games and surfaces protected-race conflicts', async () => {
    const data = scoringData(2);
    data.sessions[0].heats[0].races[0] = race(1, { name: 'Bending', isComplete: true, results: [result(1, 1, { points: 2 }), result(2, 2, { points: 1 })] });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    mount(data);
    await opened('Flag');
    await openOrganiserTools();
    expect(screen.getByRole('list', { name: 'Remaining uncompleted races' })).toHaveTextContent('Flag');
    await userEvent.click(screen.getByRole('button', { name: 'Save race line-up' }));
    expect(api.put).toHaveBeenCalledWith('/competitions/1/sessions/1/races', { raceNames: ['Bending', 'Flag'] });
    vi.mocked(api.put).mockRejectedValueOnce({ response: { data: { message: 'Protected game cannot move.' } } });
    await userEvent.click(screen.getByRole('button', { name: 'Save race line-up' }));
    expect(await screen.findByText('Protected game cannot move.')).toBeVisible();
  });

  describe('Commentator facts, post-race summary modal, and QR access', () => {
    it('turns commentator facts on from race tools, shows a line under each team, and opens the post-race toplist & heat table modal after completing a race', async () => {
      const forms: DeclarationForm[] = [
        {
          ...form(1),
          riders: [{ id: 101, fullName: 'Alice Rider', horseName: 'Starlight', isCaptain: true, isReserve: false, orderIndex: 1 }],
        },
      ];
      mount(scoringData(2), forms, vi.fn(), [standing(1, 12, { teamName: 'Oak A', bonusPoints: 10, racesRun: 2 }), standing(2, 1, { teamName: 'Beech B', racesRun: 2 })]);
      await opened('Bending');
      expect(screen.queryByRole('region', { name: 'Commentator scoring prompt' })).toBeNull();
      expect(document.querySelector('.sc-fact')).toBeNull();

      const sheet = await openTools();
      await userEvent.click(within(sheet).getByRole('switch', { name: /Commentator facts/ }));
      expect(localStorage.getItem('mg.commentatorScoring.1')).toBe('yes');
      await userEvent.click(screen.getByRole('button', { name: 'Close race tools' }));

      // Official standings (with the tack bonus) decide the line under each team.
      await waitFor(() => expect(row('Rider 1')).toHaveTextContent('Leading'));
      expect(row('Rider 2')).toHaveTextContent('11 points behind 1st');
      expect(screen.queryByRole('region', { name: 'Live commentator facts' })).toBeNull();

      // Complete a race while Commentator Mode is ON:
      await tapRider('Rider 1', 1);
      await tapRider('Rider 2', 2);
      await completeRace();

      const recapModal = await screen.findByRole('dialog', { name: 'Bending complete' });
      expect(recapModal).toHaveAccessibleDescription(/Rider 1/);
      expect(within(recapModal).getByRole('region', { name: 'Updated heat table' })).toHaveTextContent('1st Rider 1: 2 pts');
      expect(within(recapModal).getByRole('region', { name: 'Updated section toplist' })).toHaveTextContent('Oak A');

      await userEvent.click(within(recapModal).getByRole('button', { name: /Show Toplist on Stream/ }));
      expect(await within(recapModal).findByRole('status')).toHaveTextContent('Showing: Show Toplist');
      expect(saveOverlay).toHaveBeenCalled();

      await userEvent.click(within(recapModal).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bending complete' })).toBeNull());
      await opened('Flag');
    });

    describe('calling a missing team to the ring', () => {
      const late = () => competition({
        teams,
        sessions: [session(1, { status: 1, scheduledStart: '2026-06-01T10:00:00Z', heats: [heat(1, { entries: entries(2), races: [race(1, { name: 'Bending' })] })] })],
      });

      const openCallSheet = async () => {
        await userEvent.click(await screen.findByRole('button', { name: 'Call teams' }));
        return screen.getByRole('dialog', { name: 'Call teams to the ring' });
      };

      it('shows a late notice with a Call teams action, and the call buttons only in its sheet', async () => {
        mount(late());
        expect(await screen.findByText(/is late to the ring/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Call Rider 1/ })).toBeNull();
        const sheet = await openCallSheet();
        expect(within(sheet).getByRole('button', { name: /^Call Rider 1/ })).toBeInTheDocument();
        expect(within(sheet).getByRole('button', { name: /^Call Rider 2/ })).toBeInTheDocument();
      });

      it('has no late notice when the heat is not yet due', () => {
        mount(competition({
          teams,
          sessions: [session(1, { status: 1, scheduledStart: '2999-06-01T10:00:00Z', heats: [heat(1, { entries: entries(2), races: [race(1, { name: 'Bending' })] })] })],
        }));
        expect(screen.queryByText(/is late to the ring/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Call teams' })).toBeNull();
      });

      it('says "Ring call sent" in a toast rather than a green box', async () => {
        vi.mocked(api.post).mockResolvedValue({ data: {} });
        mount(late());
        const sheet = await openCallSheet();
        await userEvent.click(within(sheet).getByRole('button', { name: /^Call Rider 1/ }));
        expect(api.post).toHaveBeenCalledWith('/competitions/1/chat', expect.objectContaining({ type: 1 }));
        expect(await screen.findByText('Ring call sent')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Dismiss ring call notice' })).toBeNull();
      });

      it('offers phone and WhatsApp from the private declaration, only for usable numbers', async () => {
        mount(late(), [
          { ...form(1), trainerPhone: '+44 7700 900123' },
          { ...form(2), trainerPhone: '07700 900456' },
        ]);
        const sheet = await openCallSheet();
        const phone1 = await within(sheet).findByRole('link', { name: 'Phone the trainer of Rider 1' });
        expect(phone1).toHaveAttribute('href', 'tel:+447700900123');
        expect(screen.getByRole('link', { name: 'WhatsApp the trainer of Rider 1' }).getAttribute('href'))
          .toMatch(/^https:\/\/wa\.me\/447700900123\?text=Rider%201%3A%20you%20are%20wanted/);
        expect(screen.getByRole('link', { name: 'Phone the trainer of Rider 2' })).toHaveAttribute('href', 'tel:07700900456');
        expect(screen.queryByRole('link', { name: 'WhatsApp the trainer of Rider 2' })).toBeNull();
        expect(api.post).not.toHaveBeenCalled();
      });

      it('hides the contact row when no number is on the form', async () => {
        mount(late(), [{ ...form(1), trainerPhone: 'not a number' }, form(2)]);
        const sheet = await openCallSheet();
        expect(within(sheet).getByRole('button', { name: /^Call Rider 1/ })).toBeInTheDocument();
        expect(screen.queryByText(/Phone the trainer/)).toBeNull();
      });

      it('shows a problem strip when the call did not go', async () => {
        vi.mocked(api.post).mockRejectedValue(new Error('offline'));
        mount(late());
        const sheet = await openCallSheet();
        await userEvent.click(within(sheet).getByRole('button', { name: /^Call Rider 1/ }));
        const strip = await screen.findByRole('alert');
        expect(strip).toHaveClass('kit-strip-problem');
        expect(strip).toHaveTextContent('Couldn’t send ring call. Check your signal and try again.');
      });
    });

    it('opens the QR Code Access Hub from race tools, and comes back to scoring when it closes', async () => {
      mount(scoringData(2));
      await opened('Bending');
      const sheet = await openTools();
      await userEvent.click(within(sheet).getByRole('button', { name: /QR access/ }));
      const modal = await screen.findByRole('dialog', { name: 'Share with QR codes' });
      expect(modal).toBeInTheDocument();
      await userEvent.click(within(modal).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Share with QR codes' })).toBeNull());
      expect(screen.getByRole('region', { name: 'Scoring Bending' })).toBeInTheDocument();
    });
  });
});


it('adds a race from race tools without dropping protected games', async () => {
  const data = scoringData(2);
  data.sessions[0].heats[0].races[0] = race(1, { name: 'Bending', isComplete: true, results: [result(1, 1), result(2, 2)] });
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  mount(data);
  await opened('Flag');
  await openTools();
  await userEvent.click(screen.getByRole('button', { name: /Organiser tools/ }));
  const sheet = screen.getByRole('dialog', { name: 'Organiser tools' });
  await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Race to add' }), 'Sword');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Add race' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/sessions/1/races', {
    raceNames: ['Bending', 'Flag', 'Sword'],
  }));
});


it('keeps official tie order in the commentator line and announces the current rotated lanes', async () => {
  localStorage.setItem('mg.commentatorScoring.1', 'yes');
  mount(scoringData(2), [], vi.fn(), [standing(2, 10, { racesRun: 2 }), standing(1, 8, { racesRun: 2 })]);
  await opened('Bending');
  await waitFor(() => expect(row('Rider 2')).toHaveTextContent('Leading'));
  expect(row('Rider 1')).toHaveTextContent('2 points behind 1st');
  await userEvent.click(screen.getByRole('button', { name: 'Next race' }));
  await opened('Flag');
  const lane = screen.getByRole('button', { name: /^Rider 1, lane/ }).getAttribute('aria-label')!.split('lane ')[1];
  expect(row('Rider 1')).toHaveTextContent(`L${lane}`);
});

it('clears the in-memory draft and undo action when a race is rerun', async () => {
  vi.mocked(api.delete).mockResolvedValue({ data: {} });
  mount(scoringData(2));
  await opened('Bending');
  await tapRider('Rider 1', 1);
  const sheet = await openOrganiserTools();
  // Race controls and the score adjustments panel both offer a re-run in this sheet; the first is the race controls'.
  await userEvent.click(within(sheet).getAllByRole('button', { name: /Re-run stopped race/ })[0]);
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/sessions/races/1/results'));
  expect(screen.queryByLabelText('Place 1')).toBeNull();
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
});
