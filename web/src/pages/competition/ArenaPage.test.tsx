import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, heat, race, session } from '../../test/factories';
import { ArenaPage } from './ArenaPage';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', () => ({ useCompetition: () => state.value }));
vi.mock('../../api', () => ({ api: { get: vi.fn(async () => ({ data: [] })) } }));

const sessions = () => [
  session(1, { arenaName: 'Arena 1', status: 1, name: 'First arena session', heats: [heat(11, { sessionId: 1, label: 'Heat A', races: [race(1, { name: 'Bending' })] })] }),
  session(2, { arenaName: 'Arena 2', status: 1, name: 'Second arena session', heats: [heat(22, { sessionId: 2, label: 'Heat B', races: [race(2, { name: 'Pairs' })] })] }),
];

function show(items = sessions()) {
  state.value = { competition: competition({ sessions: items }), reload: vi.fn(), updatedAt: null };
  return render(<MemoryRouter><ArenaPage /></MemoryRouter>);
}

const templates = [
  {
    id: 1, name: 'Bending', isBuiltIn: true,
    summary: 'Weave through five bending poles.',
    rules: 'Place 5 poles in each lane.',
    diagramJson: JSON.stringify([{ t: 'pole' }, { t: 'pole' }, { t: 'pole' }, { t: 'pole' }, { t: 'pole' }]),
  },
  {
    id: 2, name: '5 Mug', isBuiltIn: true,
    summary: 'Move mugs onto alternating poles.',
    rules: null,
    diagramJson: JSON.stringify([
      { t: 'pole', on: [{ t: 'item', kind: 'mug' }] },
      { t: 'pole', on: [{ t: 'item', kind: 'mug' }] },
    ]),
  },
];

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.get).mockImplementation((async (url: string) => ({ data: url === '/race-templates' ? [] : null })) as never);
});

it('shows no arena tabs when there is only one arena', async () => {
  show(sessions().slice(0, 1));
  expect(await screen.findByRole('heading', { level: 2, name: 'Bending' })).toBeInTheDocument();
  expect(screen.queryByRole('tablist', { name: 'Arena' })).toBeNull();
});

it('shows a tab per arena and starts on the first', async () => {
  show();
  expect(await screen.findByRole('heading', { level: 2, name: 'Bending' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Arena 1' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Arena 2' })).toHaveAttribute('aria-selected', 'false');
  expect(screen.queryByRole('heading', { level: 2, name: 'Pairs' })).toBeNull();
});

it('switches to the other arena’s live heat and remembers the choice for the competition', async () => {
  show();
  fireEvent.click(await screen.findByRole('tab', { name: 'Arena 2' }));
  expect(screen.getByRole('heading', { level: 2, name: 'Pairs' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2, name: 'Bending' })).toBeNull();
  expect(localStorage.getItem('mg.arena.page.1')).toBe('Arena 2');
});

it('opens on the remembered arena and ignores one that no longer exists', async () => {
  localStorage.setItem('mg.arena.page.1', 'Arena 2');
  const first = show();
  expect(await screen.findByRole('heading', { level: 2, name: 'Pairs' })).toBeInTheDocument();
  first.unmount();
  localStorage.setItem('mg.arena.page.1', 'Gone');
  show();
  expect(await screen.findByRole('heading', { level: 2, name: 'Bending' })).toBeInTheDocument();
});

it('counts a session with no arena in every arena', async () => {
  const items = [
    ...sessions().slice(0, 1),
    session(2, { arenaName: 'Arena 2', status: 2, heats: [heat(22, { sessionId: 2, label: 'Heat B', finishedAt: '2026-06-01T10:00:00Z', races: [race(2, { isComplete: true })] })] }),
    session(3, { arenaName: null, status: 0, orderIndex: 3, heats: [heat(33, { sessionId: 3, label: 'Heat C', races: [race(3, { name: 'Relay' })] })] }),
  ];
  show(items);
  fireEvent.click(await screen.findByRole('tab', { name: 'Arena 2' }));
  expect(screen.getByRole('heading', { level: 2, name: 'Relay' })).toBeInTheDocument();
});

it('shows the last finished heat when an arena has nothing left to run, and keeps the tabs', async () => {
  const items = [
    ...sessions().slice(0, 1),
    session(2, { arenaName: 'Arena 2', status: 2, heats: [heat(22, { sessionId: 2, label: 'Heat B', finishedAt: '2026-06-01T10:00:00Z', races: [race(2, { name: 'Pairs', isComplete: true })] })] }),
  ];
  show(items);
  fireEvent.click(await screen.findByRole('tab', { name: 'Arena 2' }));
  expect(screen.getByRole('heading', { level: 2, name: 'Pairs' })).toBeInTheDocument();
  expect(screen.getByText(/Done/)).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Arena 1' })).toBeInTheDocument();
});

it('says nothing is in the arena when there are no heats at all', async () => {
  show([session(1, { arenaName: 'Arena 1', heats: [] })]);
  expect(await screen.findByText('Nothing currently in the arena.')).toBeInTheDocument();
});

it('shows one race with arrows, a heat dropdown, equipment chips and Full rules, with no footer or race chips', async () => {
  vi.mocked(api.get).mockImplementation((async (url: string) => ({ data: url === '/race-templates' ? templates : null })) as never);
  show([
    session(1, {
      arenaName: 'Arena 1', status: 1, name: 'First arena session', sectionName: 'Seniors',
      heats: [heat(11, { sessionId: 1, label: 'Heat A', races: [race(1, { name: 'Bending', orderIndex: 1 }), race(2, { name: '5 Mug', orderIndex: 2 })] })],
    }),
  ]);

  expect(await screen.findByText('Weave through five bending poles.')).toBeInTheDocument();
  expect(screen.getByText('Race 1 of 2')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Heat' })).toHaveTextContent('Seniors · Heat A');
  expect(screen.getByLabelText('Equipment required')).toHaveTextContent('5 × Pole');
  expect(screen.getByRole('button', { name: 'Full rules' })).toBeInTheDocument();
  expect(screen.queryByText(/App race guide/)).toBeNull();
  expect(screen.queryByText(/All races in this heat/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Previous$/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Previous race' })).toBeDisabled();

  await userEvent.click(screen.getByRole('button', { name: 'Next race' }));
  expect(screen.getByRole('heading', { level: 2, name: '5 Mug' })).toBeInTheDocument();
  expect(screen.getByText('Race 2 of 2')).toBeInTheDocument();
  expect(screen.getByText('Move mugs onto alternating poles.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next race' })).toBeDisabled();
  expect(screen.getByLabelText('Equipment required')).toHaveTextContent('2 × Mug');
});

it('tells the ring crew what changes before the race, with no yellow pole label', async () => {
  vi.mocked(api.get).mockImplementation((async (url: string) => ({ data: url === '/race-templates' ? templates : null })) as never);
  show([
    session(1, {
      arenaName: 'Arena 1', status: 1,
      heats: [heat(11, { sessionId: 1, label: 'Heat A', races: [race(1, { name: 'Bending', orderIndex: 1, isComplete: true }), race(2, { name: '5 Mug', orderIndex: 2 })] })],
    }),
  ]);
  expect(await screen.findByRole('heading', { level: 2, name: '5 Mug' })).toBeInTheDocument();
  const crew = await screen.findByRole('region', { name: 'Ring crew before this race' });
  expect(within(crew).getByText('Take out the 5th pole.')).toBeInTheDocument();
  expect(within(crew).getByText(/Bring in 2 × Mug/)).toBeInTheDocument();
  expect(screen.queryByText(/poles stay out/)).toBeNull();
});

it('opens the rules sheet from Full rules', async () => {
  vi.mocked(api.get).mockImplementation((async (url: string) => ({
    data: url === '/race-templates' ? templates : url.startsWith('/race-templates/by-name') ? templates[0] : null,
  })) as never);
  show(sessions().slice(0, 1));
  await screen.findByText('Weave through five bending poles.');
  await userEvent.click(screen.getByRole('button', { name: 'Full rules' }));
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByRole('heading', { name: 'Bending' })).toBeInTheDocument();
  expect(within(sheet).queryByText(/body-specific rules not verified/)).toBeNull();
});

it('chooses any heat in the arena from the dropdown', async () => {
  show([
    session(1, { arenaName: 'Arena 1', status: 1, heats: [
      heat(11, { sessionId: 1, orderIndex: 1, label: 'Heat A', races: [race(1, { name: 'Bending' })] }),
      heat(12, { sessionId: 1, orderIndex: 2, label: 'Heat B', races: [race(3, { name: 'Relay' })] }),
    ] }),
  ]);
  expect(await screen.findByRole('heading', { level: 2, name: 'Bending' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('combobox', { name: 'Heat' }));
  await userEvent.click(within(screen.getByRole('listbox', { name: 'Heat' })).getByRole('option', { name: /Heat B/ }));
  expect(screen.getByRole('heading', { level: 2, name: 'Relay' })).toBeInTheDocument();
});

it('says when a race has no setup diagram', async () => {
  show(sessions().slice(0, 1));
  expect(await screen.findByText(/No setup diagram for “Bending” yet/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Full rules' })).toBeInTheDocument();
});
