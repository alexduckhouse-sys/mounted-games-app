import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, heat, race, session } from '../../test/factories';
import { WithDock } from '../../test/dock';
import { resetRaceTemplates } from '../../lib/raceTemplates';
import { ArenaCrewPage } from './ArenaCrewPage';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', () => ({ useCompetition: () => state.value }));
vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

beforeEach(() => {
  resetRaceTemplates();
  vi.mocked(api.get).mockImplementation((async () => ({ data: [] })) as never);
  state.value = {
    competition: competition({ sessions: [session(2, { name: 'Afternoon', status: 1, orderIndex: 1, heats: [heat(21, { sessionId: 2, orderIndex: 1, races: [race(2, { name: 'Bending' })] })] })] }),
    reload: vi.fn(),
  };
});

it('keeps session, heat and zone in one sheet opened from the filters button, with a badge once the zone is narrowed', async () => {
  render(<WithDock><MemoryRouter><ArenaCrewPage /></MemoryRouter></WithDock>);
  const dock = await screen.findByTestId('dock');
  expect(dock).toHaveAttribute('data-icon', 'filters');
  expect(dock).toHaveAttribute('data-count', '0');
  expect(screen.queryByRole('button', { name: /^Zone:/ })).toBeNull();
  await userEvent.click(dock);
  const sheet = await screen.findByRole('dialog', { name: 'Session, heat and zone' });
  expect(sheet).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Zone:/ }));
  await userEvent.click(await screen.findByRole('radio', { name: 'Changeover line' }));
  await waitFor(() => expect(screen.getByTestId('dock')).toHaveAttribute('data-count', '1'));
});
