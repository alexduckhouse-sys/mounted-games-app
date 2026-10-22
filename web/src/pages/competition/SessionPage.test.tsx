import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, heat, race, session, team } from '../../test/factories';
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

  it('ticks the race clock once a second while the race is running', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-06-01T10:00:30Z'));
    const running = race(1, { name: 'Bending', startedAt: '2026-06-01T10:00:00Z' });
    mount(competition({ teams, sessions: [session(1, { status: 1, heats: [heat(1, { races: [running] })] })] }));
    expect(screen.getByText('0:30')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('0:33')).toBeInTheDocument();
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
