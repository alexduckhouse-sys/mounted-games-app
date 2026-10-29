import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition, session, heat } from '../test/factories';
import { WindReviewSheet } from './WindReviewSheet';
vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const now = Date.now();
const event = () => competition({ sessions: [session(1, { arenaName: 'Main', notes: '[paused:123] [pausefor:wind]', heats: [heat(1)] })] });
beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: { profiles: [], selections: [], candidates: [] } }); vi.mocked(api.post).mockResolvedValue({ data: {} }); });
describe('wind review decisions', () => {
  it('keeps an existing wind pause without a forecast and requires an on-site decision to resume', async () => {
    render(<WindReviewSheet competition={event()} prompt={null} hours={null} reload={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Forecast unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume racing' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('switch', { name: /official has checked/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Resume racing' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/sessions\/resume$/), expect.anything()));
  });
  it('shows other hazards and shares a review only after an explicit action', async () => {
    const prompt = { startsAt: now - 1000, endsAt: now + 3_600_000, peakMph: 37, severity: 2 as const, fetchedAt: now };
    render(<WindReviewSheet competition={event()} prompt={prompt} hours={[{ startsAt: now, weatherCode: 95, rainChance: 0, rainMm: 0 }]} reload={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Thunder is also forecast/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Equipment reviewed on site' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringMatching(/acknowledge$/), expect.objectContaining({ severity: 2, peakMph: 37, arena: 'Main' })));
  });
});
