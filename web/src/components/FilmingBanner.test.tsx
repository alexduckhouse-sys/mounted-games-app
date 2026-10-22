import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { FilmingBanner } from './FilmingBanner';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));

const row = { heatId: 2, sessionId: 1, sessionName: 'A', heatLabel: 'Heat 2', teamId: 3, teamName: 'Team 3', lane: 4,
  riderName: 'Oliver Smith', isReserve: false, heatFinished: false, sessionOrder: 1, heatOrder: 2 };

describe('FilmingBanner', () => {
  it('warns about riders in the heats about to race', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [row, { ...row, heatId: 1, heatFinished: true, riderName: 'Done Already' }] });
    render(<FilmingBanner competitionId={1} />);
    expect(await screen.findByText('Filming opt-out: Heat 2, lane 4 (Oliver Smith)')).toBeTruthy();
    expect(screen.queryByText(/Done Already/)).toBeNull();
  });

  it('shows nothing when nobody opted out', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    const { container } = render(<FilmingBanner competitionId={1} />);
    await vi.waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
