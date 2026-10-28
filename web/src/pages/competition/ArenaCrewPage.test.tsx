import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, heat, race, session } from '../../test/factories';
import type { ArenaCrewPropSheet } from '../../types';
import { resetRaceTemplates } from '../../lib/raceTemplates';
import { ArenaCrewPage } from './ArenaCrewPage';
import { defaultChoice } from './crewDutyHelpers';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./context', () => ({ useCompetition: () => state.value }));
vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const zones = (items: string[]) => [
  { zoneKey: 'start', zoneLabel: 'Start / Finish Line', items, summaryText: '' },
  { zoneKey: 'centre', zoneLabel: 'Centre Line', items: [], summaryText: '' },
  { zoneKey: 'top', zoneLabel: 'Changeover', items: ['1 × Cone per lane'], summaryText: '' },
];
const sheet = (extra: Partial<ArenaCrewPropSheet> = {}): ArenaCrewPropSheet => ({
  competitionId: 1, lanesPerHeat: 5, allHeatRaces: [],
  currentRace: { raceName: 'Bending', orderIndex: 1, bendingPolesPerLane: 5, zones: zones(['2 × Flag per lane']) },
  nextRace: { raceName: 'Mugs', orderIndex: 2, bendingPolesPerLane: 0, zones: zones([]) },
  transition: { bringIn: ['5 × Mug per lane'], clearOut: [], keepInRing: ['1 × Table per lane'], summaryText: '' },
  ...extra,
});

const sessions = () => [
  session(1, { name: 'Morning', status: 2, orderIndex: 1, heats: [heat(11, { sessionId: 1, races: [race(1, { isComplete: true })] })] }),
  session(2, { name: 'Afternoon', status: 1, orderIndex: 2, heats: [heat(21, { sessionId: 2, orderIndex: 1, races: [race(2, { name: 'Bending', isComplete: true })] }), heat(22, { sessionId: 2, orderIndex: 2, label: 'Heat B', races: [race(3, { name: 'Bending' }), race(4, { name: 'Mugs' })] })] }),
];

function show(items = sessions(), url = '/') {
  state.value = { competition: competition({ sessions: items }), reload: vi.fn() };
  return render(<MemoryRouter initialEntries={[url]}><ArenaCrewPage /></MemoryRouter>);
}

beforeEach(() => {
  resetRaceTemplates();
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url.includes('arena-crew-sheet')) return { data: sheet() };
    return { data: [] };
  }) as never);
});

it('picks the live unfinished heat and shows the now and next cards', async () => {
  show();
  expect(await screen.findByRole('heading', { name: 'Bending' })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/competitions/1/arena-crew-sheet', { params: { sessionId: 2, heatId: 22 } });
  expect(screen.getByText('2 × Flag per lane')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Next race: Mugs' })).toBeInTheDocument();
  expect(screen.getByText('5 × Mug per lane')).toBeInTheDocument();
  expect(screen.getAllByText('Nothing')).toHaveLength(1);
});

it('filters the now card by zone', async () => {
  show();
  await screen.findByText('2 × Flag per lane');
  await userEvent.click(screen.getByRole('button', { name: /^Zone:/ }));
  await userEvent.click(await screen.findByRole('radio', { name: 'Changeover line' }));
  await waitFor(() => expect(screen.queryByText('2 × Flag per lane')).not.toBeInTheDocument());
  expect(screen.getByText('1 × Cone per lane')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Zone:/ }));
  await userEvent.click(await screen.findByRole('radio', { name: 'Centre poles' }));
  expect(await screen.findByText('Nothing to set')).toBeInTheDocument();
});

it('uses the session and heat from the address, and changing them refetches', async () => {
  show(sessions(), '/?session=1&heat=11');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions/1/arena-crew-sheet', { params: { sessionId: 1, heatId: 11 } }));
  await userEvent.click(screen.getByRole('button', { name: /^Session:/ }));
  await userEvent.click(await screen.findByRole('radio', { name: /Afternoon/ }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/competitions/1/arena-crew-sheet', { params: { sessionId: 2, heatId: 22 } }));
  await userEvent.click(screen.getByRole('button', { name: /^Heat:/ }));
  await userEvent.click((await screen.findAllByRole('radio'))[0]);
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/competitions/1/arena-crew-sheet', { params: { sessionId: 2, heatId: 21 } }));
});

it('says so for the last race of a heat and an empty heat', async () => {
  vi.mocked(api.get).mockImplementation((async (url: string) => ({ data: url.includes('arena-crew-sheet') ? sheet({ nextRace: null, transition: null }) : [] })) as never);
  const { unmount } = show();
  expect(await screen.findByText(/last race of the heat/)).toBeInTheDocument();
  unmount();
  vi.mocked(api.get).mockImplementation((async () => ({ data: sheet({ currentRace: null }) })) as never);
  show();
  expect(await screen.findByText('This heat has no races yet.')).toBeInTheDocument();
});

it('builds the sheet from the timetable when the request fails', async () => {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url.includes('arena-crew-sheet')) throw new Error('offline');
    return { data: [{ id: 1, name: 'Bending', isBuiltIn: true, diagramJson: JSON.stringify([{ t: 'pole', x: 40 }]) }] };
  }) as never);
  show();
  expect(await screen.findByText(/built from the timetable/)).toBeInTheDocument();
  expect(screen.getAllByText('1 × Bending pole per lane').length).toBeGreaterThan(0);
});

it('falls back even without race templates, and rejects a bad response shape', async () => {
  vi.mocked(api.get).mockImplementation((async (url: string) => {
    if (url.includes('arena-crew-sheet')) return { data: '<html></html>' };
    throw new Error('no templates');
  }) as never);
  show();
  expect(await screen.findByText(/built from the timetable/)).toBeInTheDocument();
});

it('refetches when a race in the heat completes', async () => {
  const view = show(sessions());
  await screen.findByText('2 × Flag per lane');
  const calls = vi.mocked(api.get).mock.calls.length;
  const next = sessions();
  next[1].heats[1].races[0].isComplete = true;
  state.value = { competition: competition({ sessions: next }), reload: vi.fn() };
  view.rerender(<MemoryRouter><ArenaCrewPage /></MemoryRouter>);
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(calls));
});

it('says when there are no race sessions', () => {
  show([]);
  expect(screen.getByText(/no race sessions/)).toBeInTheDocument();
});

it('defaultChoice prefers live, then unfinished, then the last heat, and handles none', () => {
  expect(defaultChoice(sessions())).toEqual({ sessionId: 2, heatId: 22 });
  const done = sessions().map((s) => ({ ...s, status: 2 as const, heats: s.heats.map((h) => ({ ...h, races: h.races.map((r) => ({ ...r, isComplete: true })) })) }));
  expect(defaultChoice(done)).toEqual({ sessionId: 2, heatId: 22 });
  expect(defaultChoice([])).toBeNull();
  expect(defaultChoice([session(5, { isBreak: true, kind: 1 })])).toBeNull();
});
