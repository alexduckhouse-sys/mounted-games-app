import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { FAVOURITES_KEY } from '../lib/favourites';
import { competition, heat, session, team } from '../test/factories';
import { FollowingPage } from './FollowingPage';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));
const get = vi.mocked(api.get);

const entry = (teamId: number, laneIndex: number) => ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex });
const hartpury = competition({
  id: 1, name: 'Hartpury Area Festival', startDate: new Date().toISOString(), endDate: null,
  teams: [team(1, { displayName: 'Stockport A', sectionName: 'Open' }), team(2, { displayName: 'Stockport B', sectionName: 'Junior' })],
  sessions: [
    session(1, { arenaName: 'Arena 2', status: 1, heats: [heat(1, { entries: [entry(1, 2)] })] }),
    session(2, { arenaName: 'Main arena', heats: [heat(2, { entries: [] })] }),
  ],
});
const winter = competition({
  id: 2, name: 'Northern Winter League R1', startDate: '2030-11-07T09:00:00Z', endDate: null,
  teams: [team(3, { displayName: 'Wirral Pairs 2', sectionName: 'Pairs' })], sessions: [],
});
const follow = (...pairs: Array<[number, number]>) => localStorage.setItem(FAVOURITES_KEY, JSON.stringify(pairs.map(([competitionId, teamId]) => ({ competitionId, teamId }))));
const mount = () => render(<MemoryRouter><FollowingPage /></MemoryRouter>);

beforeEach(() => {
  get.mockImplementation(async (url) => ({ data: url.endsWith('/1') ? hartpury : winter, headers: {} }) as never);
});

describe('FollowingPage', () => {
  it('has a way to choose a competition when nothing is starred', () => {
    mount();
    expect(screen.getByText('No starred teams yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a competition' })).toHaveAttribute('href', '/events');
  });

  it('shows one block per event, with each starred team and its next heat', async () => {
    follow([1, 1], [1, 2], [2, 3]);
    mount();
    const first = await screen.findByRole('region', { name: 'Hartpury Area Festival' });
    expect(within(first).getByText('LIVE')).toBeInTheDocument();
    expect(within(first).getByText('Today')).toBeInTheDocument();
    const live = within(first).getByRole('link', { name: /Stockport A/ });
    expect(live).toHaveAttribute('href', '/competitions/1/following');
    expect(live).toHaveTextContent('Open · Heat 1, lane 2 · Arena 2');
    expect(live).toHaveTextContent('On now');
    expect(within(first).getByRole('link', { name: /Stockport B/ })).toHaveTextContent('Junior · not drawn yet');
    expect(within(first).getByRole('link', { name: /Stockport B/ })).toHaveTextContent('Heats TBC');
    const second = await screen.findByRole('region', { name: 'Northern Winter League R1' });
    expect(within(second).queryByText('LIVE')).not.toBeInTheDocument();
    expect(within(second).getByText('Thu 7 Nov')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Follow teams at another event' })).toHaveAttribute('href', '/events');
  });

  it('tells the user about a followed team the event no longer lists', async () => {
    follow([2, 3], [2, 77]);
    mount();
    expect(await screen.findByText('1 followed team no longer listed at this event. Open it to tidy up.')).toBeInTheDocument();
  });

  it('offers to try again when an event will not load', async () => {
    follow([1, 1]);
    get.mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t refresh this event.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('link', { name: /Stockport A/ })).toBeInTheDocument());
  });

  it('shows 12 events and then more on request', async () => {
    follow(...Array.from({ length: 14 }, (_, i): [number, number] => [i + 1, 1]));
    mount();
    await screen.findAllByRole('region');
    expect(screen.getAllByRole('region')).toHaveLength(12);
    await userEvent.click(screen.getByRole('button', { name: 'Show more events' }));
    expect(screen.getAllByRole('region')).toHaveLength(14);
  });

  it('says it is loading while an event is on its way', () => {
    follow([1, 1]);
    get.mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading event…');
  });
});
