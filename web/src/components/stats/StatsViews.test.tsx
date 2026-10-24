import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StatsGame, StatsSummary } from '../../types';
import { StatsGamesView } from './StatsGamesView';
import { StatsSummaryView } from './StatsSummaryView';

const summary: StatsSummary = {
  competitions: 2, entries: 2, placedEntries: 2, firsts: 1, seconds: 1, thirds: 0, averagePlace: 1.5,
  entriesWithFinals: 1, finalsReached: 1, aFinals: 1, aFinalPercent: 100, races: 2, wins: 1, winPercent: 50,
  points: 3, maxPoints: 6, pointQuotaPercent: 50,
};
const game = (name: string, overrides: Partial<StatsGame> = {}): StatsGame => ({
  name, races: 2, wins: 1, winPercent: 50, nonFinishes: 0, points: 5, maxPoints: 8, pointQuotaPercent: 62.5, ...overrides,
});

describe('StatsSummaryView', () => {
  it('shows each headline number with its label and the team-events note for riders', () => {
    render(<StatsSummaryView summary={summary} raceFiguresAllFormats={false} />);
    const region = screen.getByRole('region', { name: 'Summary' });
    expect(within(region).getByText('Podiums').nextSibling).toHaveTextContent('2');
    expect(within(region).getByText('1st 1 · 2nd 1 · 3rd 0')).toBeInTheDocument();
    expect(within(region).getByText('Point quota').nextSibling).toHaveTextContent('50%');
    expect(screen.getByText(/count individual and pairs competitions/)).toBeInTheDocument();
  });

  it('leaves the note out when race figures cover every format', () => {
    render(<StatsSummaryView summary={summary} raceFiguresAllFormats />);
    expect(screen.queryByText(/count individual and pairs competitions/)).not.toBeInTheDocument();
  });
});

describe('StatsGamesView', () => {
  it('lists every game with best, weakest, and per-race average', () => {
    render(<StatsGamesView games={[
      game('Bending', { averagePoints: 2.5, averagePlace: 1.5 }),
      game('Flag Race', { races: 0, wins: 0, winPercent: 0, nonFinishes: 1, points: 0, pointQuotaPercent: null }),
    ]} best={['Bending']} worst={['Flag Race']} />);
    expect(screen.getByText('Best').nextSibling).toHaveTextContent('Bending');
    expect(screen.getByText('Weakest').nextSibling).toHaveTextContent('Flag Race');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Bending21 (50%)2.5 pts (1.5)062.5%');
    expect(rows[2]).toHaveTextContent('Flag Race00 (0%)—1—');
  });

  it('skips the best and weakest lines when there are none', () => {
    render(<StatsGamesView games={[game('Bending')]} best={[]} worst={[]} />);
    expect(screen.queryByText('Best')).not.toBeInTheDocument();
    expect(screen.queryByText('Weakest')).not.toBeInTheDocument();
  });

  it('shows only best when there is no weakest, and the empty text without games', () => {
    const { rerender } = render(<StatsGamesView games={[game('Bending')]} best={['Bending']} worst={[]} />);
    expect(screen.getByText('Best')).toBeInTheDocument();
    expect(screen.queryByText('Weakest')).not.toBeInTheDocument();
    rerender(<StatsGamesView games={[]} best={[]} worst={['Bending']} />);
    expect(screen.getByText('No races to show yet.')).toBeInTheDocument();
    rerender(<StatsGamesView games={[]} best={[]} worst={[]} emptyText="Nothing yet." />);
    expect(screen.getByText('Nothing yet.')).toBeInTheDocument();
    rerender(<StatsGamesView games={[game('Bending')]} best={[]} worst={['Bending']} />);
    expect(screen.getByText('Weakest')).toBeInTheDocument();
  });
});
