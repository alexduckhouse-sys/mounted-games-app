import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import * as csv from '../../lib/csv';
import PrintEventPage from './PrintEventPage';
import { ResultsBookTab } from './ResultsBookTab';
import type { ResultsBook } from './resultsBookTypes';
import { chooseOption } from '../../test/select';

vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const get = vi.mocked(api.get);
const put = vi.mocked(api.put);

const book = (extra: Partial<ResultsBook> = {}): ResultsBook => ({
  competition: { id: 12, name: 'Spring event', location: 'Oak Farm', startDate: '2031-05-04T09:00:00Z', endDate: null },
  isProvisional: false, includesPrivate: false, generatedAt: '2031-05-04T18:00:00Z',
  sections: [{
    sectionId: 5, sectionName: 'Under 12', format: 2,
    standings: [
      { rank: 1, teamId: 1, teamName: 'North A', clubName: 'North', finalLabel: 'A Final', totalPoints: 20, bonusPoints: 2, racesRun: 4, wins: 2, eliminations: 0, withdrawn: false },
      { rank: 2, teamId: 2, teamName: 'South B', clubName: 'South', finalLabel: null, totalPoints: 10, bonusPoints: 0, racesRun: 4, wins: 0, eliminations: 1, withdrawn: true },
    ],
    finals: [{ label: 'A Final', sessionName: 'Finals', raceNames: ['Bending'], rows: [{ rank: 1, teamId: 1, teamName: 'North A', clubName: 'North', points: 5, raceCells: ['5'] }] }],
    awards: [{ id: 1, competitionSectionId: 5, title: 'Best turned out', recipient: 'North A', note: 'Gleaming' }],
  }],
  eventAwards: [{ id: 2, competitionSectionId: null, title: 'Spirit of the Games', recipient: 'Everyone', note: null }],
  refereeNotes: [],
  ...extra,
});

function renderView(view: string) {
  return render(<MemoryRouter initialEntries={[`/event-tools/12/print/${view}`]}>
    <Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes>
  </MemoryRouter>);
}

beforeEach(() => { get.mockReset(); put.mockReset(); });

describe('results book print view', () => {
  it('prints standings with bonus points, finals and awards from the public book', async () => {
    get.mockResolvedValueOnce({ data: book() });
    renderView('results-book');

    expect(await screen.findByRole('heading', { name: 'Under 12' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/event-tools/competitions/12/results-book');
    expect(screen.getByRole('columnheader', { name: 'Bonus' })).toBeInTheDocument();
    expect(screen.getByText('(withdrawn)')).toBeInTheDocument();
    expect(screen.getByText('Best turned out')).toBeInTheDocument();
    expect(screen.getByText('Spirit of the Games')).toBeInTheDocument();
    expect(screen.getAllByText('A Final').length).toBeGreaterThan(1);
    expect(screen.queryByText(/private referee notes/)).not.toBeInTheDocument();
  });

  it('shows half points as .5 and whole points without a decimal', async () => {
    const base = book();
    const section = base.sections[0];
    get.mockResolvedValueOnce({ data: book({ sections: [{ ...section,
      standings: [{ ...section.standings[0], totalPoints: 20.5, bonusPoints: 0 }, { ...section.standings[1], totalPoints: 10 }],
      finals: [{ ...section.finals[0], rows: [{ ...section.finals[0].rows[0], points: 2.5 }] }],
    }] }) });
    renderView('results-book');

    expect(await screen.findByRole('heading', { name: 'Under 12' })).toBeInTheDocument();
    expect(screen.getByText('20.5')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('2.5')).toBeInTheDocument();
    expect(screen.queryByText('20.50')).not.toBeInTheDocument();
  });

  it('marks a provisional book and downloads the CSV', async () => {
    get.mockResolvedValueOnce({ data: book({ isProvisional: true }) });
    const download = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => {});
    renderView('results-book');

    expect(await screen.findByText('Provisional results: some races are not complete.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }));
    expect(download).toHaveBeenCalledWith('Spring_event_results_book.csv', expect.stringContaining('Under 12: final standings'));
  });

  it('shows the referee notes only in the organiser copy', async () => {
    get.mockResolvedValueOnce({ data: book({ includesPrivate: true, refereeNotes: [{ sectionName: 'Under 12', heatLabel: 'A Final', raceName: 'Bending', teamName: 'South B', statusLetter: 'DNF', note: 'Lost a shoe' }] }) });
    renderView('results-book-organiser');

    expect(await screen.findByText('Referee notes (private)')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/event-tools/competitions/12/results-book/organiser');
    expect(screen.getByText('Lost a shoe')).toBeInTheDocument();
    expect(screen.getByText(/Organiser copy: this includes private referee notes/)).toBeInTheDocument();
  });

  it('says so when there is nothing to print yet', async () => {
    get.mockResolvedValueOnce({ data: book({ sections: [], eventAwards: [] }) });
    renderView('results-book');
    expect(await screen.findByText('No age groups are available yet.')).toBeInTheDocument();

    get.mockResolvedValueOnce({ data: book({ sections: [{ ...book().sections[0], standings: [], finals: [], awards: [] }], eventAwards: [] }) });
    renderView('results-book');
    expect(await screen.findByText('No results yet.')).toBeInTheDocument();
  });
});

describe('entry list print view', () => {
  it('lists teams with riders and ponies, and says when a team has none', async () => {
    get.mockResolvedValueOnce({ data: {
      competition: { id: 12, name: 'Spring event', location: null, startDate: '2031-05-04T09:00:00Z', endDate: null },
      sections: [{ sectionId: 5, sectionName: 'Under 12', teams: [
        { teamId: 1, teamName: 'North A', clubName: 'North', bib: 'Red bibs', withdrawn: false, isHorsConcours: true, riders: [
          { name: 'Oliver Smith', pony: 'Biscuit', isCaptain: true, isReserve: false, isGuest: false },
          { name: 'Ava Jones', pony: 'Biscuit', isCaptain: false, isReserve: true, isGuest: true },
        ] },
        { teamId: 2, teamName: 'South B', clubName: 'South', bib: null, withdrawn: true, isHorsConcours: false, riders: [] },
      ] }, { sectionId: 6, sectionName: 'Under 14', teams: [] }],
    } });
    renderView('entries');

    expect(await screen.findByText('Oliver Smith')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/event-tools/competitions/12/print/entries');
    expect(screen.getAllByText('Biscuit')).toHaveLength(2);
    expect(screen.getByText('Captain')).toBeInTheDocument();
    expect(screen.getByText('Reserve, Guest')).toBeInTheDocument();
    expect(screen.getByText(/HC/)).toBeInTheDocument();
    expect(screen.getByText('No riders declared yet.')).toBeInTheDocument();
    expect(screen.getByText('No teams entered yet.')).toBeInTheDocument();
  });

  it('says when no age groups exist', async () => {
    get.mockResolvedValueOnce({ data: { competition: { id: 12, name: 'Spring event', location: null, startDate: '2031-05-04T09:00:00Z', endDate: null }, sections: [] } });
    renderView('entries');
    expect(await screen.findByText('No age groups have been set up yet.')).toBeInTheDocument();
  });
});

describe('ResultsBookTab', () => {
  const mount = () => render(<MemoryRouter><ResultsBookTab competitionId="12" /></MemoryRouter>);

  beforeEach(() => {
    get.mockImplementation(async (url: string) => {
      if (url === '/competitions/12') return { data: { sections: [{ id: 5, displayName: 'Under 12' }] } };
      return { data: [{ id: 1, competitionSectionId: 5, title: 'Best turned out', recipient: 'North A', note: null }] };
    });
  });

  it('links to both copies of the book', async () => {
    mount();
    expect(await screen.findByRole('link', { name: /Results book/ })).toHaveAttribute('href', '/event-tools/12/print/results-book');
    expect(screen.getByRole('link', { name: /Organiser copy/ })).toHaveAttribute('href', '/event-tools/12/print/results-book-organiser');
  });

  it('edits, adds and removes awards, then saves the whole list', async () => {
    put.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    mount();
    expect(await screen.findByDisplayValue('Best turned out')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add an award' }));
    const groups = screen.getAllByRole('group');
    await user.type(within(groups[1]).getByLabelText('Award'), 'Spirit of the Games');
    await user.type(within(groups[1]).getByLabelText('Winner'), 'Everyone');
    await user.type(within(groups[1]).getByLabelText('Note (optional)'), 'Thank you');
    chooseOption(within(groups[1]).getByLabelText('Age group'), '5');
    await user.click(screen.getByRole('button', { name: 'Add an award' }));
    await user.click(screen.getByRole('button', { name: 'Remove award 3' }));
    await user.click(screen.getByRole('button', { name: 'Save awards' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/event-tools/competitions/12/awards', { awards: [
      { competitionSectionId: 5, title: 'Best turned out', recipient: 'North A', note: null },
      { competitionSectionId: 5, title: 'Spirit of the Games', recipient: 'Everyone', note: 'Thank you' },
    ] }));
    expect(await screen.findByText('Awards saved.')).toBeInTheDocument();
  });

  it('shows the reason when the awards cannot be saved', async () => {
    put.mockRejectedValue({ response: { data: { message: 'An award names an age group that is not in this competition.' } } });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Save awards' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An award names an age group');
  });

  it('says so when the awards cannot be loaded, and offers no save that would wipe them', async () => {
    get.mockReset();
    get.mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the awards.');
    expect(screen.queryByRole('button', { name: 'Save awards' })).not.toBeInTheDocument();
  });

  it('starts with an empty list and a hint', async () => {
    get.mockImplementation(async (url: string) => (url === '/competitions/12' ? { data: {} } : { data: [] }));
    mount();
    expect(await screen.findByText(/No special awards yet/)).toBeInTheDocument();
  });
});
