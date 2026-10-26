import { render, screen, within } from '@testing-library/react';
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
function mount(extra: Partial<CompetitionCtx> = {}, comp = data) {
  return render(<MemoryRouter initialEntries={['/competitions/1/following']}><CompetitionContext.Provider value={{ competition: comp, reload: vi.fn(), updatedAt: new Date('2026-07-01T10:00:00Z'), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [], ...extra }}><Routes><Route path="/competitions/:id"><Route path="following" element={<FollowingTab />} /></Route></Routes></CompetitionContext.Provider></MemoryRouter>);
}
describe('FollowingTab', () => {
  it('lets a signed-out visitor search, star and unstar a team', async () => {
    mount();
    // No sentence at the top, and nothing followed yet means no Teams you follow section.
    expect(screen.queryByText(/no sign-in is needed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Teams you follow' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'Blue');
    expect(screen.queryByRole('button', { name: 'Follow Example Red' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Follow Example Blue' }));
    expect(screen.getByRole('heading', { name: 'Next heats' })).toBeInTheDocument();
    expect(screen.getByText('ON NOW · Race 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('4 pts')).toBeInTheDocument();
    expect(screen.getByText('1 race')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lane 2/ })).toHaveAttribute('href', '/competitions/1/session/1?heat=1');
    expect(screen.getByRole('heading', { name: 'Teams you follow' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Example Blue' })).toHaveAttribute('href', '/competitions/1/teams/1');
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow Example Blue' }));
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
  });
  it('lists the teams you follow first, each with its next heat, with no navy dropdown', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1},{"competitionId":1,"teamId":2}]');
    mount();
    expect(screen.queryByRole('button', { name: /Following \d+ teams?/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add teams' })).not.toBeInTheDocument();
    const followed = screen.getByRole('heading', { name: 'Teams you follow' });
    const rows = within(followed.closest('section')!).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['Example BlueNext: Heat 1 · Lane 2 · on now', 'Example RedNot drawn yet']);
    // They come before the heats, the results and the finder.
    for (const later of ['Next heats', 'Latest results', 'Find a team']) {
      expect(followed.compareDocumentPosition(screen.getByRole('heading', { name: later })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
  it('has a round search bar and an outlined Follow club pill', () => {
    const club = (id: number, displayName: string) => team(id, { clubId: 7, clubName: 'Hill Pony Club', displayName });
    mount({}, competition({ teams: [club(1, 'Hill A'), club(2, 'Hill B')] }));
    const bar = screen.getByRole('searchbox').closest('label')!;
    expect(bar.className).toContain('rounded-full');
    const pill = screen.getByRole('button', { name: 'Follow club Hill Pony Club' });
    expect(pill).toHaveTextContent('Follow club');
    expect(pill.className).toMatch(/rounded-full.*border/);
    expect(pill.className).not.toContain('mg-btn-primary');
  });
  it('shows a late heat in amber with its delay and planned time', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 2 }];
    const slow = competition({ teams: data.teams, sessions: [session(1, { status: 1, scheduledStart: '2026-07-01T09:00:00Z', startedAt: '2026-07-01T09:08:00Z', heats: [
      heat(1, { startedAt: '2026-07-01T09:08:00Z', races: [race(1)] }),
      heat(2, { entries }),
    ] })] });
    mount({}, slow);
    const link = screen.getByRole('link', { name: /Lane 2/ });
    expect(link).toHaveAttribute('href', '/competitions/1/session/1?heat=2');
    expect(link).toHaveTextContent('+8 ·');
    expect(link.querySelector('s')).not.toBeNull();
    expect(link.className).toContain('mg-line-late');
  });
  it('never labels a saved running heat as live and allows refresh', async () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const reload = vi.fn();
    mount({ isStale: true, updatedAt: null, reload });
    expect(screen.getByText('WAS IN ARENA')).toBeInTheDocument();
    expect(screen.queryByText('ON NOW')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Last updated earlier. Times may have changed.');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it('says nothing about a copy that is stale in flags only, until it is noticeably old', () => {
    mount({ isStale: true, updatedAt: new Date(Date.now() - 2 * 60_000) });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('says when the copy is old and not refreshing', () => {
    mount({ isStale: true, updatedAt: new Date(Date.now() - 20 * 60_000) });
    expect(screen.getByRole('status')).toHaveTextContent(/Last updated \d\d:\d\d\. Times may have changed\./);
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
  it('names the arena on each heat only when the event has more than one', () => {
    localStorage.setItem(FAVOURITES_KEY, '[{"competitionId":1,"teamId":1}]');
    const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 3 }];
    const single = competition({ teams: data.teams, sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { entries })] })] });
    const first = mount({}, single);
    expect(screen.getByRole('link', { name: /Lane 3/ })).not.toHaveTextContent('Main Arena');
    first.unmount();
    const multi = competition({ teams: data.teams, sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { entries })] }), session(2, { arenaName: 'Ring 2' })] });
    mount({}, multi);
    expect(screen.getByRole('link', { name: /Lane 3/ })).toHaveTextContent('Main Arena');
  });
  it('follows and unfollows every entry from a club in one tap', async () => {
    const club = (id: number, clubId: number, clubName: string, displayName: string, sectionName: string) => team(id, { clubId, clubName, displayName, sectionName });
    const multi = competition({ teams: [club(1, 7, 'Hill Pony Club', 'Hill A', 'Seniors'), club(2, 7, 'Hill Pony Club', 'Hill Pair', 'Pairs'), club(3, 7, 'Hill Pony Club', 'Hill Solo', 'Individual'), club(4, 8, 'Vale Pony Club', 'Vale A', 'Seniors')] });
    mount({}, multi);
    expect(screen.getByRole('list', { name: 'Clubs' }).querySelectorAll('li')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Follow club Hill Pony Club' }));
    expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!)).toEqual([1, 2, 3].map((teamId) => ({ competitionId: 1, teamId })));
    expect(screen.getByRole('button', { name: 'Unfollow Hill Pair' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow club Vale Pony Club' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow club Hill Pony Club' }));
    expect(localStorage.getItem(FAVOURITES_KEY)).toBeNull();
    await userEvent.type(screen.getByRole('searchbox'), 'vale');
    expect(screen.queryByRole('button', { name: 'Follow club Hill Pony Club' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow Vale A' })).toBeInTheDocument();
  });
  it('tells the visitor when a club would take them over the follow limit', async () => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(Array.from({ length: 99 }, (_, i) => ({ competitionId: 9, teamId: i + 1 }))));
    const multi = competition({ teams: [team(1, { clubName: 'Hill Pony Club' }), team(2, { clubName: 'Hill Pony Club' })] });
    mount({}, multi);
    await userEvent.click(screen.getByRole('button', { name: 'Follow club Hill Pony Club' }));
    expect(screen.getByRole('alert')).toHaveTextContent('over 100 teams');
  });
});
