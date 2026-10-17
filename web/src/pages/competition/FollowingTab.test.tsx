import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { competition, heat, race, result, session, team } from '../../test/factories';
import { CompetitionContext, type CompetitionCtx } from './context';
import { FollowingTab } from './FollowingTab';

const data = competition({ teams: [team(1, { displayName: 'Example Blue' }), team(2, { displayName: 'Example Red' })], sessions: [
  session(1, { status: 1, heats: [heat(1, { entries: [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }], races: [
    race(1, { isComplete: true, results: [result(1, 1, { points: 4 })] }), race(2),
  ] })] }),
] });
function mount(extra: Partial<CompetitionCtx> = {}) {
  return render(<MemoryRouter initialEntries={['/competitions/1/following']}><CompetitionContext.Provider value={{ competition: data, reload: vi.fn(), updatedAt: new Date('2026-07-01T10:00:00Z'), ...extra }}><Routes><Route path="/competitions/:id"><Route path="following" element={<FollowingTab />} /></Route></Routes></CompetitionContext.Provider></MemoryRouter>);
}
describe('FollowingTab', () => {
  it('lets a signed-out visitor search, star and unstar a team', async () => {
    mount();
    expect(screen.getByText(/No sign-in needed/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'Blue');
    expect(screen.queryByRole('button', { name: 'Follow Example Red' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Follow Example Blue' }));
    expect(screen.getByRole('heading', { name: 'Next heats' })).toBeInTheDocument();
    expect(screen.getByText('On now')).toBeInTheDocument();
    expect(screen.getByText('4 pts · 1 race')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /starting lane 2/ })).toHaveAttribute('href', '/competitions/1/session/1?heat=1');
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow Example Blue' }));
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
  });
  it('never labels a saved running heat as live and allows refresh', async () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const reload = vi.fn();
    mount({ isStale: true, updatedAt: null, reload });
    expect(screen.getByText('Was in arena')).toBeInTheDocument();
    expect(screen.queryByText('On now')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Time unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it('lets a visitor remove a deleted team without knowing private records', async () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":99}]');
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Remove saved team' }));
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
  });
  it('keeps an unsuccessful star action visible as an error', async () => {
    mount();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await userEvent.click(screen.getByRole('button', { name: 'Follow Example Blue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('couldn’t be saved');
    expect(screen.getByRole('button', { name: 'Follow Example Blue' })).toHaveAttribute('aria-pressed', 'false');
  });
});
