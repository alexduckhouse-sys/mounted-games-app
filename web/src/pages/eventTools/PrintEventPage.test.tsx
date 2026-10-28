import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import PrintEventPage from '../operations/PrintEventPage';
import { chooseOption } from '../../test/select';

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

  it('prints one grid per heat with lanes, bibs and the scores already recorded', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: {
      competition: { id: 12, name: 'Spring event', location: null, startDate: '2031-05-04T09:00:00Z', endDate: null },
      heats: [{ heatId: 3, label: 'Heat 1', sectionName: 'Under 12', sessionName: 'Morning', scheduledStart: '2031-05-04T09:30:00Z', races: [
        { raceId: 7, name: 'Bending', teams: [
          { teamId: 5, teamName: 'South B', placing: null, eliminated: false, points: null, lane: 2, bib: 'Blue bibs' },
          { teamId: 4, teamName: 'North A', placing: 1, eliminated: false, points: 5, lane: 1, bib: 'Red bibs' },
        ] },
        { raceId: 8, name: 'Mug', teams: [
          { teamId: 5, teamName: 'South B', placing: null, eliminated: false, points: null, lane: 2, bib: 'Blue bibs' },
          { teamId: 4, teamName: 'North A', placing: null, eliminated: true, points: 0, lane: 1, bib: 'Red bibs', status: 3 },
        ] },
      ] }],
    } });
    render(<MemoryRouter initialEntries={['/event-tools/12/print/score-sheets']}><Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes></MemoryRouter>);

    const headers = (await screen.findAllByRole('columnheader')).map((cell) => cell.textContent);
    expect(headers).toEqual(['Lane', 'Team', 'Bib', '1. Bending', '2. Mug', 'Total']);
    const rows = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
    // Lane order, scores filled in where recorded, blanks left to write in.
    expect(rows).toEqual([['1', 'North A', 'Red bibs', '5', 'DNF', '5'], ['2', 'South B', 'Blue bibs', '', '', '']]);
    expect(screen.queryByText('Time TBC')).not.toBeInTheDocument();
  });

  it('says a heat has no races when it has none, and shows Time TBC only without any time', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: {
      competition: { id: 12, name: 'Spring event', location: null, startDate: '2031-05-04T09:00:00Z', endDate: null },
      heats: [{ heatId: 3, label: 'Heat 1', sectionName: '', sessionName: 'Morning', scheduledStart: null, races: [] }],
    } });
    render(<MemoryRouter initialEntries={['/event-tools/12/print/score-sheets']}><Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('No races have been added to this heat.')).toBeInTheDocument();
    expect(screen.getByText('Time TBC')).toBeInTheDocument();
  });

  it('prints the draw as a unified table with session and heat start time, lane, team, club, individual race columns and total', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: {
      competition: { id: 12, name: 'Spring event', location: 'Field Lane', startDate: '2031-05-04T09:00:00Z', endDate: null },
      sessions: [{
        sessionId: 1,
        sectionName: 'Under 12',
        sessionName: 'Morning',
        arenaName: 'Arena 1',
        orderIndex: 1,
        heats: [{
          heatId: 3,
          label: 'Heat 1',
          scheduledStart: '2031-05-04T09:30:00Z',
          teams: [
            { teamId: 5, teamName: 'South B', clubName: 'South', suffix: 'B', lane: 2 },
            { teamId: 4, teamName: 'North A', clubName: 'North', suffix: 'A', lane: 1 },
          ],
          races: [
            { raceId: 7, name: 'Bending', orderIndex: 1 },
            { raceId: 8, name: 'Mug', orderIndex: 2 },
          ],
        }],
      }],
    } });
    render(<MemoryRouter initialEntries={['/event-tools/12/print/draw']}><Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Under 12 · Morning' })).toBeInTheDocument();
    expect(screen.getByText('Arena: Arena 1')).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Lane', 'Team', '1. Bending', '2. Mug', 'Total']);
    const rows = screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
    expect(rows).toEqual([
      ['1', 'North A', '', '', ''],
      ['2', 'South B', '', '', ''],
    ]);
  });

  it('renders the printable spectator gate QR poster (with emergency what3words and no offline claim) and staff QR sheet', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/competitions/12/scorer-links')) {
        return {
          data: [
            {
              id: 77,
              label: 'Main Ring Tripod',
              arenaName: 'Arena 1',
              scope: 1,
              createdAt: '2031-05-01T09:00:00Z',
              expiresAt: '2099-05-05T09:00:00Z',
              revokedAt: null,
            },
          ],
        };
      }
      return {
        data: {
          id: 12,
          name: 'Spring event',
          location: 'Field Lane, OX1 2AB',
          what3Words: 'apple.table.chair',
          latitude: 51.75202,
          longitude: -1.25772,
          startDate: '2031-05-04T09:00:00Z',
          endDate: null,
          sections: [],
          sessions: [],
          teams: [],
        },
      };
    });

    render(
      <MemoryRouter initialEntries={['/event-tools/12/print/posters']}>
        <Routes>
          <Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Scan for Live Timetable, Scores & Stream')).toBeInTheDocument();
    expect(screen.getByText('///apple.table.chair')).toBeInTheDocument();
    expect(screen.getByText('Main Ring Tripod')).toBeInTheDocument();
    expect(screen.getByText('Tripod Camera')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  describe('headers, QR code and volunteer card', () => {
    const draw = (extra = {}) => ({ data: {
      competition: { id: 12, name: 'Spring event', location: null, startDate: '2031-05-04T09:00:00Z', endDate: null, ...extra },
      sessions: [
        { sessionId: 1, sectionName: 'Under 12', sessionName: 'Morning', arenaName: 'Ring 1', orderIndex: 1, heats: [
          { heatId: 1, label: 'Heat 1', scheduledStart: null, teams: [], races: [{ raceId: 2, name: 'Mug', orderIndex: 2 }, { raceId: 1, name: 'Bending', orderIndex: 1 }] },
          { heatId: 2, label: 'Heat 2', scheduledStart: null, teams: [], races: [{ raceId: 3, name: 'Bending', orderIndex: 1 }] },
        ] },
        { sessionId: 2, sectionName: 'Under 16', sessionName: 'Afternoon', arenaName: null, orderIndex: 2, heats: [] },
      ],
    } });
    const open = (view: string) => render(<MemoryRouter initialEntries={[`/event-tools/12/print/${view}`]}><Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes></MemoryRouter>);

    it('prints a nonblank competition number and no empty label', async () => {
      vi.mocked(api.get).mockResolvedValue(draw({ competitionNumber: ' MG-2031-04 ' }));
      const { unmount } = open('draw');
      expect(await screen.findByText('Reference: MG-2031-04')).toBeInTheDocument();
      unmount();
      vi.mocked(api.get).mockResolvedValue(draw({ competitionNumber: '   ' }));
      open('draw');
      await screen.findByRole('heading', { name: 'Spring event' });
      expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
    });

    it('puts a public live-scores QR on the draw but not on results', async () => {
      vi.mocked(api.get).mockResolvedValue(draw());
      const { unmount } = open('draw');
      expect(await screen.findByRole('img', { name: 'QR code for the live scores' })).toBeInTheDocument();
      unmount();
      vi.mocked(api.get).mockResolvedValue({ data: { competition: { id: 12, name: 'Spring event', startDate: '2031-05-04T09:00:00Z' }, isProvisional: false, sections: [] } });
      open('results');
      await screen.findByText('No sections are available yet.');
      expect(screen.queryByRole('img', { name: 'QR code for the live scores' })).not.toBeInTheDocument();
    });

    it('builds a volunteer card with games in order and kit labelled as whole event', async () => {
      vi.mocked(api.get).mockImplementation(async (url: string) => (String(url).endsWith('/equipment')
        ? { data: { lines: [{ kind: 'Pole', bucket: 'a', count: 2 }, { kind: 'Pole', bucket: 'b', count: 3 }], sessions: 2, racesCounted: 4 } }
        : draw()) as never);
      open('volunteer-card');
      const card = await screen.findByRole('region', { name: 'Volunteer card' });
      expect(card).toHaveTextContent('Ring 1');
      expect(Array.from(card.querySelectorAll('ol li')).map((li) => li.textContent)).toEqual(['Bending', 'Mug']);
      expect(await within(card).findByText('5 × Pole')).toBeInTheDocument();
      expect(card).toHaveTextContent('Kit for the whole event');
      expect(card).toHaveTextContent('Totals for every session, not just this one.');
      expect(api.get).toHaveBeenCalledWith('/competitions/12/equipment');
    });

    it('switches session', async () => {
      vi.mocked(api.get).mockImplementation(async (url: string) => (String(url).endsWith('/equipment') ? { data: { lines: [] } } : draw()) as never);
      open('volunteer-card');
      const card = await screen.findByRole('region', { name: 'Volunteer card' });
      // The kit list loads after the card first draws; wait for it so the checks below are not racing the fetch.
      await within(card).findByText('No kit listed yet.');
      chooseOption(screen.getByRole('combobox'), 'Under 16 · Afternoon');
      expect(card).toHaveTextContent('Arena to be confirmed');
      expect(card).toHaveTextContent('No games chosen yet.');
      expect(card).toHaveTextContent('No kit listed yet.');
    });

    it('still builds the card when the kit list will not load', async () => {
      vi.mocked(api.get).mockImplementation(async (url: string) => { if (String(url).endsWith('/equipment')) throw new Error('offline'); return draw() as never; });
      open('volunteer-card');
      expect(await screen.findByText(/The kit list didn’t load/)).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Volunteer card' })).toHaveTextContent('Bending');
    });

    it('says when there are no sessions', async () => {
      vi.mocked(api.get).mockImplementation(async (url: string) => (String(url).endsWith('/equipment') ? { data: { lines: [] } } : { data: { competition: { id: 12, name: 'Spring event', startDate: '2031-05-04T09:00:00Z' }, sessions: [] } }) as never);
      open('volunteer-card');
      expect(await screen.findByText('No sessions have been set up yet.')).toBeInTheDocument();
    });
  });
});
