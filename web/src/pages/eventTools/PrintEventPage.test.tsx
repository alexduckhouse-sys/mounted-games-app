import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import PrintEventPage from './PrintEventPage';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue({ data: {
    competition: { id: 12, name: 'Spring event', location: 'Field Lane', startDate: '2031-05-04T09:00:00Z', endDate: null },
    isProvisional: true,
    sections: [{ competitionSectionId: 8, sectionName: 'Under 12', results: [{ rank: 1, teamId: 4, teamName: 'North A', clubName: 'North', totalPoints: 20, racesRun: 3, wins: 2, eliminations: 0 }] }],
  } });
});

describe('PrintEventPage', () => {
  it('clears the old result shape before switching to a draw', async () => {
    let resolveDraw!: (value: unknown) => void;
    const draw = new Promise((resolve) => { resolveDraw = resolve; });
    render(<MemoryRouter initialEntries={['/event-tools/12/print/results']}><Routes><Route path="/event-tools/:competitionId/print/:view" element={<><Link to="/event-tools/12/print/draw">Show draw</Link><PrintEventPage /></>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('North A')).toBeInTheDocument();
    vi.mocked(api.get).mockImplementationOnce(() => draw as never);
    await userEvent.click(screen.getByRole('link', { name: 'Show draw' }));
    expect(screen.getByText('Preparing the print view…')).toBeInTheDocument();
    expect(screen.queryByText('North A')).not.toBeInTheDocument();
    await act(async () => { resolveDraw({ data: { competition: { id: 12, name: 'Spring event', startDate: '2031-05-04T09:00:00Z' }, sessions: [] } }); });
    expect(await screen.findByText('No draw has been set up yet.')).toBeInTheDocument();
  });

  it('labels unfinished results as provisional in the A4 view', async () => {
    render(<MemoryRouter initialEntries={['/event-tools/12/print/results']}><Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Provisional results: some races are not complete.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Spring event' })).toBeInTheDocument();
    expect(screen.getByText('North A')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/event-tools/competitions/12/print/results');
  });

  it('keeps scoring cells blank and contains wide tables on small screens', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: {
      competition: { id: 12, name: 'Spring event', location: null, startDate: '2031-05-04T09:00:00Z', endDate: null },
      heats: [{ heatId: 3, label: 'Heat 1', sectionName: 'Under 12', sessionName: 'Morning', scheduledStart: null, races: [{ raceId: 7, name: 'Bending', teams: [{ teamId: 4, teamName: 'North A', placing: 1, eliminated: true, points: 0 }] }] }],
    } });
    render(<MemoryRouter initialEntries={['/event-tools/12/print/score-sheets']}><Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes></MemoryRouter>);

    const row = await screen.findByRole('row', { name: 'North A' });
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['North A', '', '', '', '']);
    expect(row.closest('.event-print-table-wrap')).not.toBeNull();
  });
});
