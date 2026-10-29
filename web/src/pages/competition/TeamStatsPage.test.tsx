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
  it('leads with total points, points per race and races won, then the placings and points behind them', () => {
    mount();
    const summary = screen.getByRole('region', { name: 'At a glance' });
    expect(within(summary).getAllByRole('term').map((node) => node.textContent)).toEqual(['Total points', 'Points per race', 'Races won']);
    expect(fact('Total points')).toHaveTextContent('9');
    expect(fact('Points per race')).toHaveTextContent('1.8');
    expect(fact('Races won')).toHaveTextContent('2 of 5');
    expect(summary).not.toHaveTextContent('scored races');
    expect(fact('Average place')).toHaveTextContent('1.8');
    // 9 of the 15 points on offer in the five races it rode.
    expect(fact('Share of the maximum points')).toHaveTextContent('60%');
    expect(fact('Best race')).toHaveTextContent('Mug Shuffle · 2.7 avg');
    expect(fact('Hardest race')).toHaveTextContent('Two Flag · 0.5 avg');
    expect(fact('Finals reached')).toHaveTextContent('A Final');
    // The page bar already says Stats, so no heading repeats it.
    expect(screen.queryByRole('heading', { name: 'Stats' })).toBeNull();
    // The placings and points are folded away until asked for.
    const more = screen.getByText('Placings and points').closest('details')!;
    expect(more).not.toHaveAttribute('open');
  });

  it('says none when the team reached no final, and leaves out best and hardest with a single race', () => {
    const one = competition({ teams: comp.teams, sessions: [session(1, { heats: [heat(1, { entries, races: [scored(1, 'Mug Shuffle', [result(1, 1, { points: 3 })])] })] })] });
    mount(1, one);
    expect(fact('Finals reached')).toHaveTextContent('None');
    expect(screen.queryByText('Best race', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Hardest race', { selector: 'dt' })).toBeNull();
  });

  it('shows the first game as a graph of every run, with the points over each bar and only the heat or final under it', () => {
    mount();
    const section = screen.getByRole('heading', { name: 'Race performance' }).closest('section')!;
    expect(within(section).getByLabelText('Game')).toHaveValue('Mug Shuffle');
    expect(within(section).getAllByRole('option').map((node) => node.textContent)).toEqual(['Mug Shuffle', 'Two Flag']);
    const graph = within(section).getByRole('img', { name: 'Every run of Mug Shuffle' });
    const drawn = [...graph.querySelectorAll('text')].map((node) => node.textContent);
    // Points over the bars (not the places), heat names only underneath, no scale numbers.
    expect(drawn).toEqual(['3', 'Heat 1', '2', 'Heat B', '3', 'A Final']);
    expect(graph.querySelectorAll('rect')).toHaveLength(3);
    expect(within(section).getByText('Average 2.7 points · 3 runs')).toBeInTheDocument();
    // The placings are still there for screen readers.
    expect(within(section).getAllByText('A Final, 1st, 3 pts').length).toBeGreaterThan(0);
  });

  it('switches the graph to another game from the picker, writing a put-out run in words', async () => {
    mount();
    await userEvent.selectOptions(screen.getByLabelText('Game'), 'Two Flag');
    const section = screen.getByRole('heading', { name: 'Race performance' }).closest('section')!;
    const graph = within(section).getByRole('img', { name: 'Every run of Two Flag' });
    expect(graph.querySelectorAll('rect')).toHaveLength(2);
    expect(within(section).queryByRole('img', { name: 'Every run of Mug Shuffle' })).toBeNull();
    expect(within(section).getAllByText('Heat B, Did not finish, 0 pts').length).toBeGreaterThan(0);
    expect(within(section).getAllByText('Heat 1, 3rd, 1 pts').length).toBeGreaterThan(0);
    expect(within(section).getByText('Average 0.5 points · 2 runs')).toBeInTheDocument();
  });

  it('goes back to the first game when it is picked again', async () => {
    mount();
    const picker = screen.getByLabelText('Game');
    await userEvent.selectOptions(picker, 'Two Flag');
    await userEvent.selectOptions(picker, 'Mug Shuffle');
    expect(screen.getByRole('img', { name: 'Every run of Mug Shuffle' })).toBeInTheDocument();
  });

  it('says stats show once the team has raced', () => {
    mount(2, competition({ teams: comp.teams, sessions: [session(1, { heats: [heat(1, { entries, races: [race(1, { name: 'Mug Shuffle' })] })] })] }));
    expect(screen.getByText('Stats show once Rockwood has raced.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Race performance' })).toBeNull();
  });

  it('handles an unknown team', () => {
    mount(99);
    expect(screen.getByText('Team not found in this competition.')).toBeInTheDocument();
  });
});
