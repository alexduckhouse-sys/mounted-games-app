import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, team } from '../../test/factories';
import { TeamsTab } from './TeamsTab';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { chooseOption, optionLabels } from '../../test/select';

const state = vi.hoisted(() => ({ edit: true, many: false, same: false, arenas: [] as string[], toggle: vi.fn() }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./context', () => ({
  useCompetition: () => ({
    competition: state.many
      ? competition({
        sections: [{ id: 5, displayName: 'Teams Seniors' }, { id: 6, displayName: 'Teams Juniors' }] as never,
        sessions: state.arenas.length ? [
          { id: 1, competitionSectionId: 5, arenaName: state.arenas[0], isBreak: false },
          { id: 2, competitionSectionId: 5, arenaName: state.arenas[1], isBreak: false },
        ] as never : [],
        teams: [
          team(1, { displayName: 'Oak A', clubName: 'Oak Pony Club', clubId: 7, trainerUserId: null, trainerName: 'Pat Trainer' }),
          team(2, { displayName: 'Beech B', clubName: 'Beech Hunt', clubId: 8, competitionSectionId: 6, sectionName: 'Teams Juniors' }),
          ...(state.same ? [
            team(3, { displayName: 'Atherstone', clubName: ' atherstone ', clubId: 9 }),
            team(4, { displayName: 'Atherstone Juniors', clubName: 'Atherstone', clubId: 9 }),
            team(5, { displayName: 'Deeside Novices', clubName: 'Dee', clubId: 10, isHorsConcours: true }),
          ] : []),
        ],
      })
      : competition({ teams: [team(1, { displayName: 'Oak A', clubId: 7, trainerUserId: null })] }),
    reload: vi.fn(),
  }),
}));
vi.mock('../../hooks/useFavourites', () => ({ useFavourites: () => ({ favourites: [], error: null, toggle: state.toggle }) }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', clubId: 7, roles: ['Admin'] },
    hasRole: (role: string) => role === 'Admin',
    canEdit: () => state.edit,
    canOrganise: () => false,
  }),
}));

describe('TeamsTab trainers', () => {
  beforeEach(() => {
    state.edit = true;
    state.many = false;
    state.toggle.mockReset();
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      data: url === '/clubs/7/trainers' ? [{ userId: 'tr-1', fullName: 'Pat Trainer' }] : [],
    }));
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('lets an organiser put a club trainer in charge of a team', async () => {
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Change trainer for Oak A' }));
    await waitFor(() => expect(optionLabels(screen.getByLabelText('Trainer for Oak A'))).toContain('Pat Trainer'), { timeout: 5000 });
    chooseOption(screen.getByLabelText('Trainer for Oak A'), 'tr-1');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/1/teams/1', { trainerUserId: 'tr-1' }));
  });

  it('fetches a club\'s trainers only when the picker is opened', async () => {
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    expect(api.get).not.toHaveBeenCalledWith('/clubs/7/trainers');
    await userEvent.click(screen.getByRole('button', { name: 'Change trainer for Oak A' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/clubs/7/trainers'));
  });

  it('shows no trainer line at all when the viewer cannot organise', () => {
    state.edit = false;
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    expect(screen.queryByLabelText('Trainer for Oak A')).not.toBeInTheDocument();
    expect(screen.queryByText('No trainer assigned')).not.toBeInTheDocument();
  });

  it('says so when the change cannot be saved', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Change trainer for Oak A' }));
    await waitFor(() => expect(optionLabels(screen.getByLabelText('Trainer for Oak A'))).toContain('Pat Trainer'), { timeout: 5000 });
    chooseOption(screen.getByLabelText('Trainer for Oak A'), 'tr-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change the trainer. Check your signal and try again.');
  });

  it('flags a team whose dec form broke an organiser’s limit', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      data: url === '/declaration-forms' ? [{ id: 1, teamId: 1, flagCount: 2 }] : [],
    }));
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    expect(await screen.findByText('2 flagged')).toBeInTheDocument();
  });
  it('allows creating a custom team with free-text club and team name without a required suffix', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /Add custom team/ }));
    await userEvent.type(screen.getByPlaceholderText('e.g. Stockport PC'), 'New Valley PC');
    await userEvent.type(screen.getByPlaceholderText('e.g. Welsh Dragons (optional)'), 'Valley Flyers');
    await userEvent.click(screen.getByRole('button', { name: /Create team/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/1/teams', expect.objectContaining({
      clubName: 'New Valley PC',
      name: 'Valley Flyers',
      suffix: '',
    })));
  });
});

describe('TeamsTab list', () => {
  beforeEach(() => {
    state.edit = false;
    state.many = true;
    state.same = false;
    state.arenas = [];
    state.toggle.mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: [] });
  });

  it('has a round search bar that filters by team or club, and no followed-teams button', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /View followed teams/ })).toBeNull();
    const search = screen.getByRole('searchbox', { name: 'Find a team or club' });
    expect(screen.getByText('Oak A')).toBeVisible();
    expect(screen.getByText('Beech B')).toBeVisible();
    await user.type(search, 'beech');
    expect(screen.queryByText('Oak A')).toBeNull();
    expect(screen.getByText('Beech B')).toBeVisible();
    await user.clear(search);
    await user.type(search, 'oak pony');
    expect(screen.getByText('Oak A')).toBeVisible();
    expect(screen.queryByText('Beech B')).toBeNull();
    await user.clear(search);
    await user.type(search, 'zzz');
    expect(screen.getByText(/No team or club matches/)).toBeVisible();
  });

  it('picks the age group in a sheet opened from the filter button, shown as a chip you can remove', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Seniors', 'Juniors']);
    expect(screen.queryByRole('combobox', { name: 'Age group' })).toBeNull();
    const filter = screen.getByRole('button', { name: 'Age group' });
    expect(filter.querySelector('.fk-count')).toBeNull();
    await user.click(filter);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /All age groups/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sheet).getByRole('button', { name: /Juniors/ }));
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Juniors']);
    expect(screen.queryByText('Oak A')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Show 1 team' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Age group, 1 set' })).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'Remove Juniors' }));
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Seniors', 'Juniors']);
    expect(screen.queryByRole('button', { name: 'Remove Juniors' })).toBeNull();
  });

  it('heads each age group with its team count and, when there is one, its arena', () => {
    state.arenas = ['Main Arena', 'Main Arena'];
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    const seniors = screen.getByRole('region', { name: 'Seniors' });
    expect(within(seniors).getByText('1 team · Main Arena')).toBeVisible();
    const juniors = screen.getByRole('region', { name: 'Juniors' });
    expect(within(juniors).getByText('1 team')).toBeVisible();
  });

  it('shows the club under each team and no trainer or bib line', () => {
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    expect(screen.getByText('Oak Pony Club')).toBeVisible();
    expect(screen.queryByText('Pat Trainer')).toBeNull();
    expect(screen.queryByText(/No trainer assigned/)).toBeNull();
  });

  it('follows a team with a plain star button', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    const star = screen.getByRole('button', { name: 'Follow Oak A' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(star).toHaveClass('tm-star');
    expect(star.className).not.toMatch(/border|mg-icon-btn/);
    await user.click(star);
    expect(state.toggle).toHaveBeenCalledWith({ competitionId: 1, teamId: 1 });
  });

  it('shows the club only when it adds something to the team name', () => {
    state.same = true;
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    // Named after its club, in any case or spacing: no second line.
    const atherstone = screen.getByRole('link', { name: 'Atherstone' }).closest('li') as HTMLElement;
    expect(atherstone.querySelector('.fl-sub')).toBeNull();
    // The name already carries the club: no second line either.
    expect(screen.getByRole('link', { name: 'Atherstone Juniors' }).closest('li')!.querySelector('.fl-sub')).toBeNull();
    // A club that is only part of a word is new information, and so is "Hors concours".
    expect(screen.getByRole('link', { name: 'Deeside Novices' }).closest('li')!.querySelector('.fl-sub')).toHaveTextContent('Dee · Hors concours');
    // Still shown when it differs from the name.
    expect(screen.getByText('Oak Pony Club')).toBeVisible();
  });

  it('makes each whole row one link, with the star its own button beside it and nothing nested', () => {
    render(<MemoryRouter><TeamsTab /></MemoryRouter>);
    const row = screen.getByRole('link', { name: 'Oak A' }).closest('li') as HTMLElement;
    const link = within(row).getByRole('link', { name: 'Oak A' });
    const star = within(row).getByRole('button', { name: 'Follow Oak A' });
    expect(link).toHaveAttribute('href', '/competitions/1/teams/1');
    expect(link.contains(star)).toBe(false);
    expect(star.closest('a')).toBeNull();
    expect(link.querySelector('button, a, input')).toBeNull();
    expect(row.querySelectorAll('a')).toHaveLength(1);
  });

  it('puts the team count in the header apart from the event name, so a long name is cut short first', () => {
    function Header() {
      const { header } = useCompactPageBarState();
      return <p data-testid="header">{[header?.title, header?.subtitle, header?.subtitleTail].join('|')}</p>;
    }
    render(<MemoryRouter><CompactPageBarProvider><Header /><TeamsTab /></CompactPageBarProvider></MemoryRouter>);
    expect(screen.getByTestId('header')).toHaveTextContent('Teams|Spring Games|2 teams');
  });
});
