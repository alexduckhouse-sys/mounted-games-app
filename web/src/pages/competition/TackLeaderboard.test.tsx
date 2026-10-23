import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { TackLeaderboard as Board } from '../../types';
import { TackLeaderboard } from './TackLeaderboard';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const get = vi.mocked(api.get);

const board = (mode: 1 | 2): Board => ({
  sections: [{
    sectionId: 5, sectionName: 'Under 12', mode, maxPoints: 10, sectors: ['Bit', 'Boots'],
    rows: [
      { rank: 1, teamId: 1, teamName: 'Oak A', clubName: 'Oak', points: [9, 8], total: 17, isHorsConcours: false },
      { rank: null, teamId: 2, teamName: 'Ash A', clubName: '', points: [7, null], total: 7, isHorsConcours: true },
    ],
  }, { sectionId: 6, sectionName: 'Open', mode: 1, maxPoints: 10, sectors: ['Bit'], rows: [] }],
});

beforeEach(() => { get.mockReset(); });

describe('Tack & Turnout table', () => {
  it('shows the age group’s table with HC teams unranked and unmarked sectors as a dash', async () => {
    get.mockResolvedValueOnce({ data: board(1) });
    render(<TackLeaderboard competitionId={12} sectionId={5} />);

    expect(await screen.findByRole('heading', { name: 'Tack & Turnout' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/event-tools/competitions/12/tack-check/leaderboard');
    expect(screen.getByText(/not added to the standings/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Boots' })).toBeInTheDocument();
    expect(screen.getByText('HC')).toBeInTheDocument();
    expect(screen.getByText('Not marked')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it('says when the points are bonus points in the standings', async () => {
    get.mockResolvedValueOnce({ data: board(2) });
    render(<TackLeaderboard competitionId={12} sectionId={5} />);
    expect(await screen.findByText(/added to each team’s total above as tack check bonus points/)).toBeInTheDocument();
  });

  it('shows nothing for an age group with no marks, no table, a bad answer or a failed load', async () => {
    get.mockResolvedValueOnce({ data: board(1) });
    const { container, rerender } = render(<TackLeaderboard competitionId={12} sectionId={6} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
    rerender(<TackLeaderboard competitionId={12} sectionId={99} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores an answer that is not a table, and a failed load', async () => {
    get.mockResolvedValueOnce({ data: '<html>' });
    const first = render(<TackLeaderboard competitionId={12} sectionId={5} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    get.mockRejectedValueOnce(new Error('offline'));
    const second = render(<TackLeaderboard competitionId={12} sectionId={5} refresh={1} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });
});
