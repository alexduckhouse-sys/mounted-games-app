import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setFavourites, toggleFavourite } from '../../lib/favourites';
import { FOLLOW_BAR_ASKED_KEY } from '../../lib/followingCards';
import { getBottomTabs, setBottomTabs } from '../../lib/userPrefs';
import { competition, team } from '../../test/factories';
import { CompetitionContext } from './context';
import { FollowBarPrompt } from './FollowBarPrompt';

const comp = competition({ teams: [team(1, { displayName: 'Atherstone' }), team(2, { displayName: 'Rockwood' }), team(3, { displayName: 'Oakley' })] });

function mount() {
  return render(<MemoryRouter><CompetitionContext.Provider value={{ competition: comp, reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 0, streamMessages: [] }}><FollowBarPrompt /></CompetitionContext.Provider></MemoryRouter>);
}
const follow = (teamId: number, competitionId = 1) => act(() => { toggleFavourite({ competitionId, teamId }); });

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
});

describe('FollowBarPrompt', () => {
  it('offers to add Following to the bottom bar the first time a team is followed, with a preview of the bar', async () => {
    mount();
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
    follow(1);
    expect(await screen.findByText('You’re following Atherstone')).toBeInTheDocument();
    expect(screen.getByText(/Add Following to your bottom bar/)).toBeInTheDocument();
    const bar = screen.getByRole('img', { name: 'Your bottom bar with Following added' });
    expect(bar).toHaveTextContent('TimetableToplistsLive streamFollowingDetails');
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });
  it('adds the Following tab, and never asks again', async () => {
    mount();
    follow(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Add to bottom bar' }));
    await waitFor(() => expect(getBottomTabs()).toEqual(['timetable', 'toplists', 'chat', 'following', 'details']));
    expect(localStorage.getItem(FOLLOW_BAR_ASKED_KEY)).toBe('added');
    await waitFor(() => expect(screen.queryByText('You’re following Atherstone')).not.toBeInTheDocument());
  });
  it('leaves the bar alone on Not now, and remembers the answer', async () => {
    mount();
    follow(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(localStorage.getItem(FOLLOW_BAR_ASKED_KEY)).toBe('declined'));
    expect(getBottomTabs()).toEqual(['timetable', 'toplists', 'chat', 'details']);
    follow(2);
    expect(screen.queryByText('You’re following Rockwood')).not.toBeInTheDocument();
  });
  it('stays quiet when Following is already on the bar', () => {
    setBottomTabs(['following', 'timetable']);
    mount();
    follow(1);
    expect(screen.queryByText('You’re following Atherstone')).not.toBeInTheDocument();
    expect(localStorage.getItem(FOLLOW_BAR_ASKED_KEY)).toBeNull();
  });
  it('stays quiet when a team of another competition is followed, or a team is unfollowed', () => {
    mount();
    follow(1, 9);
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
    localStorage.setItem(FOLLOW_BAR_ASKED_KEY, 'declined');
    follow(1);
    expect(screen.queryByText('You’re following Atherstone')).not.toBeInTheDocument();
  });
  it('stays quiet for a team this competition does not list', () => {
    mount();
    follow(77);
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
  });
  it('says how many when a whole club is followed at once', async () => {
    mount();
    act(() => { setFavourites([{ competitionId: 1, teamId: 1 }, { competitionId: 1, teamId: 2 }], true); });
    expect(await screen.findByText('You’re following 2 teams')).toBeInTheDocument();
  });
});
