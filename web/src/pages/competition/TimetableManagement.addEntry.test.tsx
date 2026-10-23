import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { competition, session } from '../../test/factories';
import { api } from '../../api';
import { TimetableManagement } from './TimetableManagement';
import { chooseOption, optionLabels } from '../../test/select';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', () => ({ useCompetition: () => state.value }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ canManage: () => true, canOrganise: () => true, canEdit: () => true, hasRole: () => true }),
}));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../components/WeatherChips', () => ({ WeatherNow: () => null, WeatherAt: () => null }));

function show(arenaNames: (string | null)[]) {
  const sessions = arenaNames.map((arenaName, i) => session(i + 1, { arenaName, name: `Race session ${i + 1}` }));
  state.value = { competition: competition({ sessions }), reload: vi.fn(), updatedAt: null };
  return render(<MemoryRouter><TimetableManagement /></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue({ data: {} });
});

it('has no arena picker for a single-arena competition and saves no arena', async () => {
  show(['Arena 1', 'Arena 1']);
  fireEvent.click(screen.getByRole('button', { name: /Break/ }));
  expect(screen.queryByRole('combobox', { name: 'Arena' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Add to timetable/ }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ arenaName: null });
});

it('offers each arena plus all arenas, defaulting to all arenas (null)', async () => {
  show(['Arena 1', 'Arena 2', ' Arena 2 ', null]);
  fireEvent.click(screen.getByRole('button', { name: /Break/ }));
  expect(optionLabels(screen.getByRole('combobox', { name: 'Arena' }))).toEqual(['All arenas', 'Arena 1', 'Arena 2']);
  fireEvent.click(screen.getByRole('button', { name: /Add to timetable/ }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ arenaName: null });
});

it('saves the chosen arena on a break', async () => {
  show(['Arena 1', 'Arena 2']);
  fireEvent.click(screen.getByRole('button', { name: /Break/ }));
  chooseOption(screen.getByRole('combobox', { name: 'Arena' }), 'Arena 2');
  fireEvent.click(screen.getByRole('button', { name: /Add to timetable/ }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ arenaName: 'Arena 2' });
});

it('also asks for an arena when adding a briefing or a custom item', () => {
  show(['Arena 1', 'Arena 2']);
  fireEvent.click(screen.getByRole('button', { name: /Briefing/ }));
  expect(screen.getByRole('combobox', { name: 'Arena' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
  expect(screen.getByRole('combobox', { name: 'Arena' })).toBeInTheDocument();
});
