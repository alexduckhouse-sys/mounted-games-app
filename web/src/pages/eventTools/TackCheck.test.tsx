import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { TackCheckBoard, TackCheckSection } from '../../types';
import PrintEventPage from '../operations/PrintEventPage';
import { TackCheckTab } from './TackCheckTab';
import type { PrintableTackCheck } from './TackCheckPrint';
import { chooseOption } from '../../test/select';

vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);

const team = (teamId: number, extra: Partial<TackCheckSection['teams'][number]> = {}) => ({
  teamId, teamName: `Team ${teamId}`, clubName: 'Oak', isHorsConcours: false, withdrawn: false, marks: [], total: 0, passed: 0, failed: 0, ...extra,
});

const section = (extra: Partial<TackCheckSection> = {}): TackCheckSection => ({
  sectionId: 5, sectionName: 'Under 12', configured: true, isEnabled: true, mode: 0, maxPoints: 10,
  sectors: [{ id: 11, name: 'Bit' }, { id: 12, name: 'Boots' }],
  teams: [team(1), team(2, { isHorsConcours: true, withdrawn: true })],
  ...extra,
});

const board = (...sections: TackCheckSection[]): TackCheckBoard => ({ competitionId: 12, sections });

function renderTab() {
  return render(<MemoryRouter><TackCheckTab competitionId="12" /></MemoryRouter>);
}

beforeEach(() => { get.mockReset(); put.mockReset(); });

describe('tack check tab', () => {
  it('starts an unconfigured age group with the default sectors, switched on, and saves the set-up', async () => {
    const fresh = section({ configured: false, isEnabled: false, sectors: ['Saddle/Girth', 'Bridle/Bit', 'Rider Hat/Boots', 'Turnout'].map((name) => ({ id: 0, name })) });
    get.mockResolvedValueOnce({ data: board(fresh) });
    put.mockResolvedValueOnce({ data: section({ mode: 2, maxPoints: 5, sectors: [{ id: 21, name: 'Saddle/Girth' }, { id: 22, name: 'Bridle/Bit' }, { id: 23, name: 'Rider Hat/Boots' }, { id: 24, name: 'Turnout' }, { id: 25, name: 'Plaits' }] }) });
    renderTab();

    expect(await screen.findByLabelText('Run a tack check for Under 12')).toBeChecked();
    expect(get).toHaveBeenCalledWith('/event-tools/competitions/12/tack-check');
    expect(screen.getByRole('link', { name: /Print tack check forms/ })).toHaveAttribute('href', '/event-tools/12/print/tack-check');
    expect(screen.queryByLabelText('Most points per rider per sector')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Bonus points/));
    const max = screen.getByLabelText('Most points per rider per sector');
    await userEvent.clear(max);
    await userEvent.type(max, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Add a sector' }));
    await userEvent.type(screen.getByLabelText('Sector 5'), 'Plaits');
    await userEvent.click(screen.getByRole('button', { name: 'Save tack check' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/event-tools/competitions/12/tack-check/sections/5', {
      isEnabled: true, mode: 2, maxPoints: 5,
      sectors: [{ id: null, name: 'Saddle/Girth' }, { id: null, name: 'Bridle/Bit' }, { id: null, name: 'Rider Hat/Boots' }, { id: null, name: 'Turnout' }, { id: null, name: 'Plaits' }],
    }));
    expect(await screen.findByText('Tack check saved')).toBeInTheDocument();
    // The saved section now shows the stewards' results.
    expect(screen.getByText('Points out of 5 per rider in each sector')).toBeInTheDocument();
  });

  it('checks the sectors and maximum before saving, and shows a refusal from the server', async () => {
    get.mockResolvedValueOnce({ data: board(section()) });
    put.mockRejectedValueOnce({ response: { data: { detail: 'Two sectors have the same name.' } } });
    renderTab();

    const first = await screen.findByLabelText('Sector 1');
    await userEvent.clear(first);
    await userEvent.click(screen.getByRole('button', { name: 'Save tack check' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give every sector a name');
    await userEvent.type(first, 'Hat');
    await userEvent.click(screen.getByLabelText(/Tack & Turnout table/));
    const max = screen.getByLabelText('Most points per rider per sector');
    await userEvent.clear(max);
    await userEvent.type(max, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save tack check' }));
    expect(screen.getByRole('alert')).toHaveTextContent('whole number from 1 to 100');
    await userEvent.clear(max);
    await userEvent.type(max, '8');
    await userEvent.click(screen.getByRole('button', { name: 'Remove sector 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save tack check' }));

    expect(await screen.findByText('Two sectors have the same name.')).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith('/event-tools/competitions/12/tack-check/sections/5', { isEnabled: true, mode: 1, maxPoints: 8, sectors: [{ id: 11, name: 'Hat' }] });
  });

  it('records pass or fail for a team and refreshes it from the answer', async () => {
    get.mockResolvedValueOnce({ data: board(section()) });
    put.mockResolvedValueOnce({ data: section({ teams: [team(1, { marks: [{ sectorId: 11, passed: true, points: null }, { sectorId: 12, passed: false, points: null }], passed: 1, failed: 1 }), team(2)] }) });
    renderTab();

    const form = await screen.findByRole('form', { name: 'Team 1' });
    expect(screen.getByRole('form', { name: 'Team 2' })).toHaveTextContent('(HC, withdrawn)');
    const save = within(form).getByRole('button', { name: 'Save Team 1' });
    expect(save).toBeDisabled();
    chooseOption(within(form).getByLabelText('Bit'), 'pass');
    chooseOption(within(form).getByLabelText('Boots'), 'fail');
    await userEvent.click(save);

    await waitFor(() => expect(put).toHaveBeenCalledWith('/event-tools/competitions/12/tack-check/sections/5/teams/1', {
      marks: [{ sectorId: 11, passed: true, points: null }, { sectorId: 12, passed: false, points: null }],
    }));
    expect(await screen.findByText('1 passed, 1 failed')).toBeInTheDocument();
  });

  it('records per-rider points in a grid, sums rider and team totals, refuses too many, and shows a failed save', async () => {
    const scoredSection = section({
      mode: 2, maxPoints: 5,
      teams: [
        { ...team(1), riders: ['Amy Archer', 'Ben Brook'] } as TackCheckSection['teams'][number],
        team(2, { isHorsConcours: true, withdrawn: true }),
      ],
    });
    get.mockResolvedValueOnce({ data: board(scoredSection) });
    put.mockRejectedValueOnce({ response: { data: { title: 'Marks not saved' } } });
    renderTab();

    const form = await screen.findByRole('form', { name: 'Team 1' });
    await userEvent.type(within(form).getByLabelText('Amy Archer Bit'), '7');
    await userEvent.click(within(form).getByRole('button', { name: 'Save Team 1' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Points go from 0 to 5.');
    expect(put).not.toHaveBeenCalled();

    await userEvent.clear(within(form).getByLabelText('Amy Archer Bit'));
    await userEvent.type(within(form).getByLabelText('Amy Archer Bit'), '4');
    await userEvent.type(within(form).getByLabelText('Amy Archer Boots'), '5');
    await userEvent.type(within(form).getByLabelText('Ben Brook Bit'), '3');
    expect(within(form).getByTestId('rider-total-0')).toHaveTextContent('9');
    expect(within(form).getByTestId('rider-total-1')).toHaveTextContent('3');
    expect(within(form).getByTestId('team-total')).toHaveTextContent('12 pts');
    await userEvent.click(within(form).getByRole('button', { name: 'Save Team 1' }));
    expect(await within(form).findByText('Marks not saved')).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith('/event-tools/competitions/12/tack-check/sections/5/teams/1', {
      marks: [
        { sectorId: 11, passed: null, points: 7, riderPoints: [4, 3] },
        { sectorId: 12, passed: null, points: 5, riderPoints: [5, null] },
      ],
    });
  });

  it('switches between age groups and explains an empty one', async () => {
    get.mockResolvedValueOnce({ data: board(section(), section({ sectionId: 6, sectionName: 'Open', teams: [] })) });
    renderTab();

    chooseOption(await screen.findByLabelText('Age group'), '6');
    expect(screen.getByLabelText('Run a tack check for Open')).toBeInTheDocument();
    expect(screen.getByText('No teams in this age group yet.')).toBeInTheDocument();
  });

  it('hides the results until the check is on, and handles no age groups and load errors', async () => {
    get.mockResolvedValueOnce({ data: board(section({ isEnabled: false })) });
    const first = renderTab();
    expect(await screen.findByLabelText('Run a tack check for Under 12')).not.toBeChecked();
    expect(screen.queryByRole('form', { name: 'Team 1' })).not.toBeInTheDocument();
    first.unmount();

    get.mockResolvedValueOnce({ data: board() });
    const second = renderTab();
    expect(await screen.findByText('Add an age group to this competition first.')).toBeInTheDocument();
    second.unmount();

    get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: board(section()) });
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the tack check.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('form', { name: 'Team 1' })).toBeInTheDocument();
  });
});

describe('tack check print view', () => {
  const printable = (extra: Partial<PrintableTackCheck> = {}): PrintableTackCheck => ({
    competition: { id: 12, name: 'Spring event', location: null, startDate: '2031-05-04T09:00:00Z', endDate: null },
    sections: [
      {
        sectionId: 5, sectionName: 'Under 12', isEnabled: true, mode: 2, maxPoints: 5, sectors: ['Bit', 'Boots'],
        teams: [
          { teamId: 1, teamName: 'Oak A', clubName: 'Oak', bib: null, withdrawn: false, isHorsConcours: true, riders: [
            { name: 'Amy Archer', pony: 'Bramble', isCaptain: true, isReserve: false, isGuest: false },
            { name: 'Ruby Reserve', pony: null, isCaptain: false, isReserve: true, isGuest: false },
          ] },
          { teamId: 2, teamName: 'Ash A', clubName: 'Ash', bib: null, withdrawn: true, isHorsConcours: false, riders: [] },
        ],
      },
      { sectionId: 6, sectionName: 'Open', isEnabled: false, mode: 0, maxPoints: 10, sectors: ['Turnout'], teams: [] },
    ],
    ...extra,
  });

  function renderPrint() {
    return render(<MemoryRouter initialEntries={['/event-tools/12/print/tack-check']}>
      <Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes>
    </MemoryRouter>);
  }

  it('prints a form per age group with riders, ponies and a column per sector', async () => {
    get.mockResolvedValueOnce({ data: printable() });
    renderPrint();

    expect(await screen.findByRole('heading', { name: 'Under 12' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/event-tools/competitions/12/print/tack-check');
    expect(screen.getByText('Write the points, 0 to 5, in each sector.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Write P (pass) or F (fail) in each sector.', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Boots' })).toBeInTheDocument();
    expect(screen.getByText('Oak A (HC)')).toBeInTheDocument();
    expect(screen.getByText('Bramble')).toBeInTheDocument();
    expect(screen.getByText('Ruby Reserve (reserve)')).toBeInTheDocument();
    expect(screen.getByText('Ash A (withdrawn)')).toBeInTheDocument();
    expect(screen.getByText('No declaration yet')).toBeInTheDocument();
    expect(screen.getByText('No teams entered yet.')).toBeInTheDocument();
  });

  it('adds a tack bonus column to the printed results only when a section has bonus points', async () => {
    const row = (teamId: number, totalPoints: number, bonusPoints: number) => ({ rank: teamId, teamId, teamName: `Team ${teamId}`, clubName: 'Oak', totalPoints, racesRun: 2, wins: 1, eliminations: 0, bonusPoints });
    get.mockResolvedValueOnce({ data: {
      competition: { id: 12, name: 'Spring event', location: null, startDate: '2031-05-04T09:00:00Z', endDate: null }, isProvisional: false,
      sections: [
        { competitionSectionId: 5, sectionName: 'Under 12', results: [row(1, 9, 4), row(2, 3, 0)] },
        { competitionSectionId: 6, sectionName: 'Open', results: [row(3, 5, 0)] },
      ],
    } });
    render(<MemoryRouter initialEntries={['/event-tools/12/print/results']}>
      <Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes>
    </MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Under 12' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: 'Tack bonus' })).toHaveLength(1);
    expect(screen.getByRole('row', { name: /Team 1/ })).toHaveTextContent('Team 194');
  });

  it('says so when there are no age groups', async () => {
    get.mockResolvedValueOnce({ data: printable({ sections: [] }) });
    renderPrint();
    expect(await screen.findByText('No age groups have been set up yet.')).toBeInTheDocument();
  });
});
