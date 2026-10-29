import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { CurrentCompetitionProvider } from '../../competition/CurrentCompetitionContext';
import { TickerProvider } from '../../components/TickerContext';
import { TopBarTicker } from '../../components/TopBarTicker';
import { EntriesPage } from './EntriesPage';

const reload = vi.fn();
const competition = { id: 7, name: 'Spring Open', startDate: '2031-05-04T09:00:00.000Z', endDate: '2031-05-05T17:00:00.000Z', signupsLocked: false, teams: [], sections: [], sessions: [] };
vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition, reload }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const entry = (teamId: number, teamName: string, sectionId: number, sectionName: string, status = 0) => ({
  teamId, teamName, sectionId, sectionName, isHorsConcours: false, status, reason: null, changedAt: null, canReinstate: true, redrawAvailable: false,
});
const entries = [entry(1, 'Oak A', 11, 'Under 12'), entry(2, 'Elm B', 11, 'Under 12'), entry(3, 'Ash C', 12, 'Under 15', 1)];
const signups = [
  { id: 101, teamId: 1, status: 1, competitionSectionId: 11, sectionName: 'Under 12', fullName: 'A', amountMinor: 1000, createdAt: '' },
  { id: 102, teamId: 2, status: 0, competitionSectionId: 11, sectionName: 'Under 12', fullName: 'B', amountMinor: 1000, createdAt: '' },
];
const forms = [{
  id: 5, teamId: 1, teamName: 'Oak A', competitionId: 7, competitionName: 'Spring Open', submittedAt: '2031-05-01T14:02:00.000Z', isLocked: false, trainerName: 'Sam',
  notes: 'Late arrival', riders: [{ id: 1, fullName: 'Ada', horseName: 'Biscuit', isCaptain: true, isReserve: false, orderIndex: 0, ponyHeightHands: 13.2, birthYear: 2018, flags: ['Weight is over the limit'] }],
}];
const config = { config: { dob: 2, dobFormat: 0, weight: 0, weightUnit: 0, ponyHeight: 2, ponyPassport: 0, ponyAge: 0, membershipNumber: 0, emergencyContact: 0, medicalNotes: 0, trainerPhone: 1, bib: 1,
  customFields: [{ id: 'f1', label: 'Pony weight', type: 1, required: false, min: null, max: 80, unit: 'kg' }, { id: 'f2', label: 'Saddle size', type: 0, required: false }] }, isStandard: false, formsSubmitted: 1 };

function Address() {
  return <output data-testid="address">{useLocation().search}</output>;
}

function show() {
  return render(<MemoryRouter><EntriesPage /></MemoryRouter>);
}

function showDocked() {
  return render(
    <MemoryRouter>
      <CurrentCompetitionProvider>
        <TickerProvider>
          <EntriesPage />
          <TopBarTicker />
        </TickerProvider>
      </CurrentCompetitionProvider>
    </MemoryRouter>,
  );
}

describe('EntriesPage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/entries')) return { data: entries } as never;
      if (path.endsWith('/signups')) return { data: signups } as never;
      if (path === '/declaration-forms') return { data: forms } as never;
      if (path.endsWith('/lock-time')) return { data: { declarationsCloseAt: null } } as never;
      return { data: config } as never;
    });
    vi.mocked(api.put).mockResolvedValue({ data: config });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

  it('says Demo paid on a demo event', async () => {
    Object.assign(competition, { isDemo: true });
    try {
      show();
      expect(await screen.findByRole('button', { name: /Oak A/ })).toHaveTextContent('Demo paid');
    } finally {
      delete (competition as { isDemo?: boolean }).isDemo;
    }
  });

  it('shows entries grouped by section, closed up, with payment, form and status', async () => {
    show();
    const first = await screen.findByRole('button', { name: /Oak A/ });
    expect(screen.getByRole('heading', { name: 'Under 12' })).toBeInTheDocument();
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(first).toHaveTextContent('Paid');
    expect(first).toHaveTextContent('Form in');
    expect(first).toHaveTextContent('Flagged');
    expect(screen.getByText('Not paid', { selector: '.ops-badge-pending' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Elm B/ })).toHaveTextContent('Missing');
    // Withdrawn teams fold away at the end of their section.
    expect(screen.queryByRole('button', { name: /Ash C/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Withdrawn or no-show (1)' }));
    expect(screen.getByRole('button', { name: /Ash C/ })).toHaveTextContent('Withdrawn');
    expect(screen.getByText('Entries open')).toBeInTheDocument();
    expect(screen.getByText('1 paid · 1 not paid')).toBeInTheDocument();
    expect(screen.queryByText(/Call/)).not.toBeInTheDocument();
  });

  it('opens a row in place to show the form, and a missing one offers the form link', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    show();
    await user.click(await screen.findByRole('button', { name: /Oak A/ }));
    expect(screen.getByText('Weight is over the limit')).toBeInTheDocument();
    expect(screen.getByText('Trainer: Sam')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Late arrival')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Elm B/ }));
    expect(screen.getByText('Not received yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy form link' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/competitions/7/declarations'));
  });

  it('shows unpaid entries as pending payment with a quick Mark paid on the row', async () => {
    const user = userEvent.setup();
    const asked = autoConfirm(true);
    show();
    await screen.findByRole('button', { name: /^Elm B/ });
    expect(screen.getAllByText('Not paid', { selector: '.ops-badge-pending' })).toHaveLength(1);
    expect(screen.getByText('£10 by bank transfer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark Elm B paid' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups/102/mark-paid'));
    expect(asked.titles).toEqual(['Mark Elm B paid?']);
  });

  it('lists unpaid sign-ups with no team yet under All, and does not say there are no entries', async () => {
    const user = userEvent.setup();
    const pendingOnly = { id: 201, teamId: null, status: 0, competitionSectionId: 11, sectionName: 'Under 12', fullName: 'Casey', amountMinor: 1500, createdAt: '' };
    vi.mocked(api.get).mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/entries')) return { data: [] } as never;
      if (path.endsWith('/signups')) return { data: [pendingOnly] } as never;
      if (path === '/declaration-forms') return { data: [] } as never;
      if (path.endsWith('/lock-time')) return { data: { declarationsCloseAt: null } } as never;
      return { data: config } as never;
    });
    autoConfirm(true);
    show();
    // In the main list, in its own section, marked Not paid.
    expect(await screen.findByText('Casey')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Under 12' })).toBeInTheDocument();
    expect(screen.getByText('Not paid', { selector: '.ops-badge-pending' })).toBeInTheDocument();
    expect(screen.queryByText('No entries yet.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark Casey paid' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups/201/mark-paid'));
  });

  it('marks a team paid and not paid', async () => {
    const user = userEvent.setup();
    autoConfirm(true);
    show();
    await user.click(await screen.findByRole('button', { name: /^Elm B/ }));
    await user.click(screen.getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups/102/mark-paid'));

    await user.click(screen.getByRole('button', { name: /Oak A/ }));
    await user.click(screen.getByRole('button', { name: 'Mark not paid' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/signups/101/status', { status: 0 }));
  });

  it('withdraws with a reason, marks a no-show and reinstates, all from the entry', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({ data: { team: entries[0], heatPlacesChanged: 0, changedSessionIds: [] } });
    show();
    await user.click(await screen.findByRole('button', { name: /Oak A/ }));
    await user.click(screen.getByRole('button', { name: 'Withdraw this entry' }));
    let sheet = screen.getByRole('dialog');
    await user.type(within(sheet).getByLabelText('Reason'), 'Pony lame');
    await user.click(within(sheet).getByRole('button', { name: 'Withdraw team' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/teams/1/entry-status', { status: 1, reason: 'Pony lame' }));
    expect(await screen.findByText('Oak A is out.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Elm B/ }));
    await user.click(screen.getByRole('button', { name: 'No-show' }));
    sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Mark as no-show' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/teams/2/entry-status', { status: 2, reason: null }));

    await user.click(screen.getByRole('button', { name: 'Withdrawn or no-show (1)' }));
    await user.click(screen.getByRole('button', { name: /Ash C/ }));
    await user.click(screen.getByRole('button', { name: 'Reinstate' }));
    sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Reinstate team' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/teams/3/entry-status', { status: 0, reason: null }));
  });

  it('opens the rider swap from the entry', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Oak A/ }));
    await user.click(screen.getByRole('button', { name: 'Swap rider' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the chosen filter in the address', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/competitions/7/operations/entries?show=pending']}><EntriesPage /><Address /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Show: Pending payment (1)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show: Pending payment (1)' }));
    await user.click(screen.getByRole('option', { name: 'Paid (1)' }));
    expect(screen.getByTestId('address')).toHaveTextContent('?show=paid');
    await user.click(screen.getByRole('button', { name: 'Show: Paid (1)' }));
    await user.click(screen.getByRole('option', { name: 'All teams' }));
    expect(screen.getByTestId('address')).toBeEmptyDOMElement();
  });

  it('closes entries', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Close entries' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups-locked', { locked: true }));
    expect(reload).toHaveBeenCalled();
  });

  it('edits the deadline with the date row and saves it on Done', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Deadline: Not set' }));
    const panel = screen.getByRole('dialog', { name: 'Deadline' });
    await user.click(within(panel).getByRole('gridcell', { name: 'Sunday 4 May' }));
    await user.click(within(panel).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/declaration-forms/competition/7/lock-time', { declarationsCloseAt: expect.stringMatching(/^2031-05-04/) }));
  });

  it('removes and adds questions and saves each at once', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getAllByText('Pony weight').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Remove Saddle size' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/dec-form-config', expect.objectContaining({ customFields: [expect.objectContaining({ id: 'f1' })] })));

    await user.click(screen.getByRole('button', { name: '+ Add a question' }));
    await user.click(screen.getByRole('option', { name: 'Rider’s weight' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/dec-form-config', expect.objectContaining({ weight: 1 })));

    await user.click(screen.getByRole('button', { name: '+ Add a question' }));
    await user.click(screen.getByRole('option', { name: 'Write your own…' }));
    await user.type(screen.getByLabelText('Question'), 'Rider height');
    await user.click(screen.getByRole('button', { name: 'Add question' }));
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/7/dec-form-config', expect.objectContaining({ customFields: expect.arrayContaining([expect.objectContaining({ label: 'Rider height', type: 0 })]) })));
  });

  it('shows the flag rules a number question has and changes one limit', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Answer: Pony weight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Is: is over' })).toBeInTheDocument();
    const value = screen.getByLabelText('Value');
    expect(value).toHaveValue('80');
    await user.clear(value);
    await user.type(value, '90');
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/dec-form-config', expect.objectContaining({ customFields: expect.arrayContaining([expect.objectContaining({ id: 'f1', max: 90 })]) })));

    await user.click(screen.getByRole('button', { name: 'Remove rule' }));
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/7/dec-form-config', expect.objectContaining({ customFields: expect.arrayContaining([expect.objectContaining({ id: 'f1', max: null })]) })));
  });

  it('adds a flag rule once it has a value', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: '+ Add a flag rule' }));
    const values = screen.getAllByLabelText('Value');
    await user.type(values[1], '20');
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7/dec-form-config', expect.objectContaining({ customFields: expect.arrayContaining([expect.objectContaining({ id: 'f1', max: 20 })]) })));
  });

  it('shows why a change failed', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { message: 'Nope.' } } });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Close entries' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope.');
  });

  it('puts the entry and dec form tools in a sheet opened from the dock', async () => {
    const user = userEvent.setup();
    showDocked();
    await screen.findByRole('button', { name: /Oak A/ });
    expect(screen.queryByText('Entries open')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close entries' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entries and dec form tools' }));
    const sheet = await screen.findByRole('dialog', { name: 'Entries and dec form tools' });
    expect(within(sheet).getByText('Entries open')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Entry tools' })).toBeInTheDocument();
    expect(within(sheet).getByText('Show')).toBeInTheDocument();
    expect(within(sheet).getByText('Questions and flags')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Close entries' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/signups-locked', { locked: true }));
  });
});
