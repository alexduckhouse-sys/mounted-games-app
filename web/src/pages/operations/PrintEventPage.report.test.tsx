import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { downloadCsv } from '../../lib/csv';
import PrintEventPage from './PrintEventPage';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../lib/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/csv')>()), downloadCsv: vi.fn() }));

const competition = { id: 12, name: 'Spring event', location: 'Field Lane', startDate: '2031-05-04T09:00:00Z', endDate: null };
const heat = (heatId: number, label: string, teams: Array<[number, string]>) => ({ heatId, label, scheduledStart: null, races: [{ raceId: heatId, name: 'Race 1', orderIndex: 1 }], teams: teams.map(([teamId, teamName], i) => ({ teamId, teamName, clubName: 'Club', suffix: '', lane: i + 1 })) });
const draw = {
  competition,
  sessions: [
    { sessionId: 5, sectionName: 'Under 12', sessionName: 'Session 1', arenaName: null, orderIndex: 1, heats: [heat(1, 'Heat 1', [[1, 'Oak A']])] },
    { sessionId: 6, sectionName: 'Under 14', sessionName: 'Session 1', arenaName: null, orderIndex: 2, heats: [heat(2, 'Heat 2', [[2, 'Elm B']])] },
  ],
};
const sheetHeat = (heatId: number, sectionName: string, teamName: string) => ({ heatId, label: 'Heat', sectionName, sessionName: 'Session 1', scheduledStart: null, races: [{ raceId: heatId, name: 'Race 1', teams: [{ teamId: heatId, teamName, placing: null, eliminated: false, points: null, lane: 1 }] }] });

function show(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes></MemoryRouter>);
}

describe('PrintEventPage for one session', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/print/draw')) return { data: draw };
      if (url.endsWith('/print/score-sheets')) return { data: { competition, heats: [sheetHeat(1, 'Under 12', 'Oak A'), sheetHeat(2, 'Under 14', 'Elm B')] } };
      if (url.endsWith('/print/results')) return { data: { competition, isProvisional: false, sections: [] } };
      throw new Error(`unexpected ${url}`);
    });
  });

  it('prints only the chosen session of the draw and links back to all of them', async () => {
    show('/event-tools/12/print/draw?sessionId=6');
    expect(await screen.findByText('Elm B')).toBeInTheDocument();
    expect(screen.queryByText('Oak A')).not.toBeInTheDocument();
    expect(screen.getByText('One session only.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show every session' })).toHaveAttribute('href', '/event-tools/12/print/draw');
  });

  it('prints all of the draw without a session id, and ignores a bad one', async () => {
    show('/event-tools/12/print/draw?sessionId=abc');
    expect(await screen.findByText('Oak A')).toBeInTheDocument();
    expect(screen.getByText('Elm B')).toBeInTheDocument();
    expect(screen.queryByText('One session only.')).not.toBeInTheDocument();
  });

  it('keeps the score sheets that belong to the session', async () => {
    show('/event-tools/12/print/score-sheets?sessionId=5');
    expect(await screen.findByText('Oak A')).toBeInTheDocument();
    expect(screen.queryByText('Elm B')).not.toBeInTheDocument();
  });

  it('asks the API for one session of the results', async () => {
    show('/event-tools/12/print/results?sessionId=5');
    expect(await screen.findByText('No sections are available yet.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/event-tools/competitions/12/print/results', { params: { sessionId: 5 } });
  });

  it('shows why a session sheet could not load', async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { data: { detail: 'No luck' } } });
    show('/event-tools/12/print/score-sheets?sessionId=5');
    expect(await screen.findByText('No luck')).toBeInTheDocument();
  });
});

describe('PrintEventPage sponsor report', () => {
  const sponsors = [
    { id: 1, name: 'Acme Feeds', tier: 0, showOn: 1 | 2, views: 40, seconds: 90 },
    { id: 2, name: 'Bay Saddlery', tier: 1, showOn: 8, views: 10, seconds: 0 },
  ];
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(downloadCsv).mockReset();
  });
  const serve = (stats: unknown) => vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.endsWith('/sponsor-stats')) { if (stats === null) throw new Error('403'); return { data: stats }; }
    if (url.endsWith('/sponsors/manage')) return { data: sponsors };
    if (url === '/competitions/12') return { data: { ...competition, sections: [{}, {}], teams: [{}, {}, {}], sessions: [] } };
    return { data: { competition, sessions: [] } };
  });

  it('shows real totals and no invented split when the API gives no figures by place', async () => {
    serve(null);
    show('/event-tools/12/print/sponsor-report');
    const table = await screen.findByRole('table');
    const acme = within(table).getByText('Acme Feeds').closest('tr')!;
    expect(within(acme).getByText('40')).toBeInTheDocument();
    expect(within(acme).getByText('0h 1m 30s')).toBeInTheDocument();
    expect(within(acme).getByText('Timetable, Results')).toBeInTheDocument();
    expect(within(acme).getByText('Not counted by place')).toBeInTheDocument();
    expect(screen.queryByText(/Bib/)).not.toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('shows the figures by place that the API counted', async () => {
    serve({ sponsors: [{ sponsorId: 1, sponsorName: 'Acme Feeds', totalViews: 52, totalSeconds: 120, showOn: 3, placements: [{ key: 'timetable', label: 'Timetable', views: 30, seconds: 0 }, { key: 'standings', label: 'Standings', views: 22, seconds: 0 }] }] });
    show('/event-tools/12/print/sponsor-report');
    expect(await screen.findByText('Timetable 30, Results 22')).toBeInTheDocument();
  });

  it('uses plain wording and downloads a plain CSV', async () => {
    serve(null);
    show('/event-tools/12/print/sponsors');
    const user = userEvent.setup();
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: /Download as CSV/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print or save as PDF/ })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/SponsorExposure|Proof-of-Value|1-Click/);
    await user.click(screen.getByRole('button', { name: /Download as CSV/ }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());
    const [name, csv] = vi.mocked(downloadCsv).mock.calls[0];
    expect(name).toBe('Spring_event-sponsor-report.csv');
    expect(csv).toContain('Sponsor,Level,Total views');
    expect(csv).toContain('Acme Feeds,Headline,40,0h 1m 30s,90,"Timetable, Results",Not counted by place');
  });

  it('says so when there are no sponsors', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.endsWith('/sponsor-stats')) return { data: { sponsors: [] } };
      if (url.endsWith('/sponsors/manage')) return { data: [] };
      return { data: { competition, sessions: [] } };
    });
    show('/event-tools/12/print/sponsor-report');
    expect(await screen.findByText('No sponsors have been added to this event yet.')).toBeInTheDocument();
  });
});
