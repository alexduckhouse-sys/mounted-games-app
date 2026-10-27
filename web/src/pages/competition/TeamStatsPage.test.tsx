import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CompactPageBarProvider } from '../../components/CompactPageBarContext';
import { competition, heat, race, result, session, team } from '../../test/factories';
import type { CompetitionDetail } from '../../types';
import { CompetitionContext } from './context';
import { TeamStatsPage } from './TeamStatsPage';

const entries = [1, 2, 3].map((id) => ({ id, teamId: id, teamName: `Team ${id}`, laneIndex: id }));
const scored = (id: number, name: string, results: ReturnType<typeof result>[]) => race(id, { name, isComplete: true, results });

const comp = competition({
  name: 'Spring Games',
  sections: [{ id: 5, competitionId: 1, format: 2, ageGroup: 'Seniors', displayName: 'Seniors' }],
  teams: [team(1, { displayName: 'Atherstone' }), team(2, { displayName: 'Rockwood' })],
  sessions: [
    session(1, { status: 2, heats: [
      heat(1, { finishedAt: '2026-07-01T09:00:00Z', entries, races: [
        scored(1, 'Mug Shuffle', [result(1, 1, { points: 3 }), result(2, 2, { points: 2 })]),
        scored(2, 'Two Flag', [result(1, 3, { points: 1 }), result(2, 1, { points: 3 })]),
      ] }),
      heat(2, { label: 'Heat B', entries, races: [
        scored(3, 'Mug Shuffle', [result(1, 2, { points: 2 }), result(2, 1, { points: 3 })]),
        scored(4, 'Two Flag', [result(1, null, { points: 0, eliminated: true, status: 3 }), result(2, 1, { points: 3 })]),
      ] }),
    ] }),
    session(2, { name: 'Seniors finals', heats: [heat(3, { label: 'A Final', raceRoundStage: 2, entries, races: [
      scored(5, 'Mug Shuffle', [result(1, 1, { points: 3 }), result(2, 2, { points: 2 })]),
    ] })] }),
  ],
});

function mount(teamId = 1, data: CompetitionDetail = comp) {
  return render(<MemoryRouter initialEntries={[`/competitions/1/teams/${teamId}/stats`]}><CompactPageBarProvider>
    <CompetitionContext.Provider value={{ competition: data, reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] }}>
      <Routes><Route path="/competitions/:id/teams/:teamId/stats" element={<TeamStatsPage />} /></Routes>
    </CompetitionContext.Provider>
  </CompactPageBarProvider></MemoryRouter>);
}
const fact = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('TeamStatsPage', () => {
  it('lists every fact: averages, wins, point quota, best and hardest race, total points and the finals reached', () => {
    mount();
    expect(fact('Average per race')).toHaveTextContent('1.8 pts');
    expect(fact('Average place')).toHaveTextContent('1.8');
    expect(fact('Races won')).toHaveTextContent('2 of 5');
    expect(fact('Point quota')).toHaveTextContent('%');
    expect(fact('Best race')).toHaveTextContent('Mug Shuffle · 2.7 avg');
    expect(fact('Hardest race')).toHaveTextContent('Two Flag · 0.5 avg');
    expect(fact('Total points')).toHaveTextContent('9');
    expect(fact('Finals reached')).toHaveTextContent('A Final');
  });

  it('says none when the team reached no final, and leaves out best and hardest with a single race', () => {
    const one = competition({ teams: comp.teams, sessions: [session(1, { heats: [heat(1, { entries, races: [scored(1, 'Mug Shuffle', [result(1, 1, { points: 3 })])] })] })] });
    mount(1, one);
    expect(fact('Finals reached')).toHaveTextContent('None');
    expect(screen.queryByText('Best race', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Hardest race', { selector: 'dt' })).toBeNull();
  });

  it('gives each race its points per run, with its runs, best place and total underneath', () => {
    mount();
    const races = screen.getByRole('heading', { name: 'Each race' }).closest('section')!;
    const items = within(races).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Mug Shuffle');
    expect(items[0]).toHaveTextContent('3 runs · best 1st · 8 pts in total');
    expect(items[0]).toHaveTextContent('2.7 avg');
    expect(items[1]).toHaveTextContent('Two Flag');
    expect(items[1]).toHaveTextContent('2 runs · best 3rd · 1 pts in total');
  });

  it('opens a race into a graph of every run, with the place over each bar and the heat or final under it', async () => {
    mount();
    const toggle = screen.getByRole('button', { name: /Mug Shuffle/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('img', { name: 'Every run of Mug Shuffle' })).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const graph = screen.getByRole('img', { name: 'Every run of Mug Shuffle' });
    const drawn = [...graph.querySelectorAll('text')].map((node) => node.textContent);
    expect(drawn).toEqual(expect.arrayContaining(['1st', '2nd', 'Heat 1', 'Heat B', 'A Final']));
    expect(graph.querySelectorAll('rect')).toHaveLength(3);
    expect(screen.getByText('Average 2.7 pts a run')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Every run of Mug Shuffle' })).toHaveTextContent('A Final, 1st, 3 pts');
    // Only one race is open at a time.
    await userEvent.click(screen.getByRole('button', { name: /Two Flag/ }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('writes a put-out run as its letter, and an unplaced one in words', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Two Flag/ }));
    const graph = screen.getByRole('img', { name: 'Every run of Two Flag' });
    expect([...graph.querySelectorAll('text')].map((node) => node.textContent)).toContain('DNF');
    expect(screen.getByRole('region', { name: 'Every run of Two Flag' })).toHaveTextContent('Heat B, Did not finish, 0 pts');
  });

  it('closes an open race when it is tapped again', async () => {
    mount();
    const toggle = screen.getByRole('button', { name: /Mug Shuffle/ });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('says stats show once the team has raced', () => {
    mount(2, competition({ teams: comp.teams, sessions: [session(1, { heats: [heat(1, { entries, races: [race(1, { name: 'Mug Shuffle' })] })] })] }));
    expect(screen.getByText('Stats show once Rockwood has raced.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Each race' })).toBeNull();
  });

  it('handles an unknown team', () => {
    mount(99);
    expect(screen.getByText('Team not found in this competition.')).toBeInTheDocument();
  });
});
