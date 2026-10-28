import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { competition, heat, race, result, session, standing, team } from '../../test/factories';
import { TvKioskPage } from './TvKioskPage';
import { CommentaryDeskPage } from './CommentaryDeskPage';

const state = vi.hoisted(() => ({ value: null as unknown, get: vi.fn() }));
vi.mock('./context', () => ({ useCompetition: () => state.value }));
vi.mock('../../api', () => ({ api: { get: state.get } }));
// Stands in for 30 seconds passing (useHeldFor has its own timing test).
const held = vi.hoisted(() => ({ value: true }));
vi.mock('../../hooks/useHeldFor', () => ({ useHeldFor: (active: boolean) => active && held.value }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => false }) }));
vi.mock('../../components/stream/StreamControlStrip', () => ({ StreamControlStrip: () => <div>Staff stream controls</div> }));
vi.mock('../../components/QrAccessModal', () => ({ QrAccessModal: () => null }));
vi.mock('../../live/useLiveHub', () => ({ useLiveHub: () => ({ connected: true }) }));
vi.mock('../../components/CompactPageBarContext', () => ({ usePageHeader: () => {} }));
vi.mock('../../components/pageWidthState', () => ({ usePageWidth: () => {} }));
vi.mock('../../components/SponsorStrip', () => ({ SponsorStrip: () => null }));
vi.mock('../../components/SponsorBadge', () => ({ SponsorBadge: () => null }));

beforeEach(() => {
  held.value = true;
  state.get.mockImplementation((url: string) => Promise.resolve({ data: url.includes('/standings') ? [standing(1, 8.5)] : [] }));
  state.value = { reload: vi.fn(), competition: competition({
    sections: [{ id: 5, displayName: 'Seniors', finalistCount: 0 }] as never,
    teams: [team(1)],
    sessions: [session(1, { heats: [heat(1, { entries: [{ id: 1, teamId: 1, teamName: 'Team 1', laneIndex: 1 }],
      races: [race(1, { isComplete: true, results: [result(1, 1, { points: 3 })] })] })] })],
  }) };
});

describe.each([
  ['TV', TvKioskPage, 'Live Section Standings'],
  ['commentator', CommentaryDeskPage, 'Standings — Each Team in Order'],
] as const)('%s official standings', (label, Page, region) => {
  it('keeps official totals and labels them as saved when a live refresh fails', async () => {
    const view = render(<MemoryRouter><Page /></MemoryRouter>);
    expect(screen.queryByText('Staff stream controls')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stream Controls' })).toBeNull();
    if (label === 'TV') await userEvent.click(screen.getByRole('button', { name: 'Live Section Standings' }));
    const rows = await screen.findByRole('region', { name: region });
    await waitFor(() => expect(rows).toHaveTextContent('8.5'));
    const previous = state.value as { competition: ReturnType<typeof competition>; reload: () => void };
    state.get.mockRejectedValue(new Error('Synthetic offline failure'));
    state.value = { ...previous, competition: { ...previous.competition, teams: [...previous.competition.teams] } };
    held.value = false;
    const calls = state.get.mock.calls.length;
    view.rerender(<MemoryRouter><Page /></MemoryRouter>);
    await waitFor(() => expect(state.get.mock.calls.length).toBeGreaterThan(calls));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A refresh that fails shows nothing at first: old standings only get a notice once they have lasted 30 seconds.
    expect(screen.queryByText('Showing saved standings while results refresh.')).toBeNull();
    held.value = true;
    view.rerender(<MemoryRouter><Page /></MemoryRouter>);
    await screen.findByText('Showing saved standings while results refresh.');
    expect(screen.getByRole('region', { name: region })).toHaveTextContent('8.5');
  });
});
