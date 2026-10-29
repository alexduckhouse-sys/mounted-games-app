import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, team } from '../../test/factories';
import { WithDock } from '../../test/dock';
import { TeamsTab } from './TeamsTab';

const state = vi.hoisted(() => ({ organiser: false }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./context', () => ({
  useCompetition: () => ({
    competition: competition({
      sections: [{ id: 5, displayName: 'Teams Seniors' }, { id: 6, displayName: 'Teams Juniors' }] as never,
      teams: [
        team(1, { displayName: 'Oak A', clubName: 'Oak Pony Club', clubId: 7 }),
        team(2, { displayName: 'Beech B', clubName: 'Beech Hunt', clubId: 8, competitionSectionId: 6, sectionName: 'Teams Juniors' }),
      ],
    }),
    reload: vi.fn(),
  }),
}));
vi.mock('../../hooks/useFavourites', () => ({ useFavourites: () => ({ favourites: [], error: null, toggle: vi.fn() }) }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', clubId: 7, roles: [] },
    hasRole: () => false,
    canEdit: () => false,
    canOrganise: () => state.organiser,
  }),
}));

beforeEach(() => {
  state.organiser = false;
  vi.mocked(api.get).mockResolvedValue({ data: [] });
});

it('puts the age-group filter on the dock button for spectators, with the badge, and the search spans the row', async () => {
  render(<WithDock><MemoryRouter><TeamsTab /></MemoryRouter></WithDock>);
  const dock = await screen.findByTestId('dock');
  expect(dock).toHaveAttribute('data-icon', 'filters');
  expect(dock).toHaveAttribute('data-count', '0');
  expect(document.querySelector('.fk-fbtn')).toBeNull();
  await userEvent.click(dock);
  const sheet = within(await screen.findByRole('dialog'));
  await userEvent.click(sheet.getByRole('button', { name: /Juniors/ }));
  expect(screen.getByTestId('dock')).toHaveAttribute('data-count', '1');
});

it('keeps the filter beside the search, and Add team on the dock, for organisers', async () => {
  state.organiser = true;
  render(<WithDock><MemoryRouter><TeamsTab /></MemoryRouter></WithDock>);
  const dock = await screen.findByTestId('dock');
  expect(dock).toHaveAttribute('data-icon', 'plus');
  expect(screen.getAllByTestId('dock')).toHaveLength(1);
  expect(document.querySelector('.fk-fbtn')).not.toBeNull();
});
