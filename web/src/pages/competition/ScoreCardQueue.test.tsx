import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { QueuedScoreCard } from '../../lib/scoreCard';
import { ScoreCardQueue } from './ScoreCardQueue';

vi.mock('../../api', () => ({ api: { post: vi.fn() } }));

const card = (raceId: number, extra: Partial<QueuedScoreCard> = {}): QueuedScoreCard => ({
  key: `k${raceId}`, arenaName: 'Arena 1', heading: 'Seniors Session 1 · Heat 2', receivedAt: 1,
  card: { heatId: 5, raceId, raceName: `Race ${raceId}`, raceNumber: 1, raceCount: 3, rows: [
    { teamId: 1, teamName: 'England', total: 6, added: 6, eliminated: false, place: 1, change: null },
    { teamId: 2, teamName: 'Wales', total: 5, added: 5, eliminated: false, place: 2, change: null },
  ] },
  ...extra,
});

beforeEach(() => { vi.mocked(api.post).mockResolvedValue({ data: {} }); });

describe('ScoreCardQueue', () => {
  it('says what will appear before any results arrive', () => {
    render(<ScoreCardQueue competitionId={1} cards={[]} onError={vi.fn()} />);
    expect(screen.getByText('Cards appear here as results come in.')).toBeInTheDocument();
  });

  it('lists the newest cards first and shows or skips one', async () => {
    render(<ScoreCardQueue competitionId={1} cards={[card(1), card(2, { arenaName: '' })]} onError={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('after Race 2');
    expect(items[1]).toHaveTextContent('after Race 1 · Arena 1');

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Show now' })[0]); });
    expect(api.post).toHaveBeenLastCalledWith('/competitions/1/overlays/score-card', { heatId: 5, raceId: 2, action: 'show' });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Skip' })[1]); });
    expect(api.post).toHaveBeenLastCalledWith('/competitions/1/overlays/score-card', { heatId: 5, raceId: 1, action: 'skip' });
  });

  it('edits rows, names and time on screen, then closes the editor', async () => {
    render(<ScoreCardQueue competitionId={1} cards={[card(1, { names: { 2: 'Wales A' }, hiddenTeamIds: [], seconds: 12 })]} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Name shown for Wales')).toHaveValue('Wales A');
    fireEvent.click(screen.getByLabelText('Show England'));
    fireEvent.change(screen.getByLabelText('Name shown for Wales'), { target: { value: 'Wales Seniors A' } });
    fireEvent.change(screen.getByLabelText('On screen for', { exact: false }), { target: { value: '99' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply to this card' })); });

    expect(api.post).toHaveBeenLastCalledWith('/competitions/1/overlays/score-card',
      { heatId: 5, raceId: 1, action: 'edit', hiddenTeamIds: [1], names: { 2: 'Wales Seniors A' }, seconds: 60 });
    expect(screen.queryByRole('button', { name: 'Apply to this card' })).toBeNull();
  });

  it('can bring a hidden row back, clear the time and close the editor unsent', () => {
    render(<ScoreCardQueue competitionId={1} cards={[card(1, { hiddenTeamIds: [1] })]} onError={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByLabelText('Show England'));
    expect(screen.getByLabelText('Show England')).toBeChecked();
    fireEvent.change(screen.getByLabelText('On screen for', { exact: false }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('button', { name: 'Apply to this card' })).toBeNull();
  });

  it('reports when the instruction can’t be sent', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('no signal'));
    const onError = vi.fn();
    render(<ScoreCardQueue competitionId={1} cards={[card(1)]} onError={onError} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip' })); });
    expect(onError).toHaveBeenCalledWith('Couldn’t reach the score card. Check your connection and try again.');
  });
});
