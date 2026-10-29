import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, heat, race, session } from '../../test/factories';
import { WithDock } from '../../test/dock';
import { ArenaPage } from './ArenaPage';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', () => ({ useCompetition: () => state.value }));
vi.mock('../../api', () => ({ api: { get: vi.fn(async () => ({ data: [] })) } }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.get).mockImplementation((async (url: string) => ({ data: url === '/race-templates' ? [] : null })) as never);
});

it('opens the arena and heat sheet from the list button beside the dock, and drops the inline row', async () => {
  state.value = {
    competition: competition({ sessions: [
      session(1, { arenaName: 'Arena 1', status: 1, heats: [heat(11, { sessionId: 1, label: 'Heat A', races: [race(1, { name: 'Bending' })] })] }),
      session(2, { arenaName: 'Arena 2', status: 1, heats: [heat(22, { sessionId: 2, label: 'Heat B', races: [race(2, { name: 'Pairs' })] })] }),
    ] }),
    reload: vi.fn(), updatedAt: null,
  };
  render(<WithDock><MemoryRouter><ArenaPage /></MemoryRouter></WithDock>);
  await screen.findByRole('heading', { level: 2, name: 'Bending' });
  const dock = screen.getByTestId('dock');
  expect(dock).toHaveAttribute('data-icon', 'list');
  expect(dock).toHaveAttribute('data-count', '0');
  expect(screen.queryByRole('button', { name: /Arena 1 · /, hidden: false })).toBeNull();
  await userEvent.click(dock);
  expect(await screen.findByRole('dialog', { name: 'Arena and heat' })).toBeInTheDocument();
});
