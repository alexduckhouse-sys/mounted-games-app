import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompetitionDetail, DeclarationForm, Role, SavedRider, SavedTeamDeclaration } from '../../types';
import { competition, team } from '../../test/factories';
import { decDraftKey } from '../../lib/decForm';
import { CompetitionContext } from './context';
import { DeclarationsTab } from './DeclarationsTab';
import { autoConfirm } from '../../test/confirm';
import { chooseOption } from '../../test/select';
import { CurrentCompetitionProvider } from '../../competition/CurrentCompetitionContext';
import { TickerProvider } from '../../components/TickerContext';
import { TopBarTicker } from '../../components/TopBarTicker';

const state = vi.hoisted(() => ({
  user: { id: 'u1', fullName: 'Alex Morgan', email: 'alex@example.com', clubId: 1, clubName: 'Stockport PC', roles: ['Trainer'] } as { id: string; fullName: string; email: string; clubId: number | null; clubName: string; roles: Role[] } | null,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  download: vi.fn(),
  organise: false,
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: state.user,
    hasRole: (role: Role) => !!state.user?.roles.includes(role),
    canOrganise: () => state.organise,
  }),
}));
vi.mock('../../api', () => ({ readStoredAuth: () => state.user ? { user: state.user } : null, api: { get: state.get, post: state.post, put: state.put, delete: state.del } }));
vi.mock('../../lib/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/csv')>()), downloadCsv: state.download }));

const saved: SavedRider[] = [
  { id: 1, clubId: 1, fullName: 'Ella Hughes', dateOfBirth: '2015-04-05T00:00:00', horseName: 'Pickle', ponyHeightHands: 13.2 },
  { id: 2, clubId: 1, fullName: 'Oliver Smith', dateOfBirth: '2014-09-12T00:00:00', horseName: 'Bramble', ponyHeightHands: 14 },
  { id: 3, clubId: 1, fullName: 'Maisie Clarke', dateOfBirth: '2016-01-22T00:00:00', horseName: 'Toffee', ponyHeightHands: 12.3 },
  { id: 4, clubId: 1, fullName: 'Harry Wood', dateOfBirth: '2015-06-30T00:00:00', horseName: 'Jasper', ponyHeightHands: 13.1 },
  { id: 5, clubId: 1, fullName: 'Ruby Ash', dateOfBirth: '2016-03-14T00:00:00', horseName: 'Domino', ponyHeightHands: 12.2 },
  { id: 6, clubId: 1, fullName: 'Leo Grant', dateOfBirth: '2015-11-02T00:00:00', horseName: null, ponyHeightHands: null },
];

let forms: DeclarationForm[];
let savedRiders: SavedRider[];
let savedTeams: SavedTeamDeclaration[] | null;

const comp = (extra: Partial<CompetitionDetail> = {}) => competition({
  id: 4, name: 'Cheshire Area MG', startDate: '2026-10-24', termsText: 'Hats must be worn.\nNo bare feet.',
  sections: [{ id: 5, competitionId: 4, format: 2, ageGroup: 'U10', displayName: 'U10' }, { id: 6, competitionId: 4, format: 1, ageGroup: 'U12', displayName: 'U12 Pairs' }],
  teams: [team(7, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport C', trainerUserId: 'u1' })],
  ...extra,
});

function mount(extra: Partial<CompetitionDetail> = {}, url = '/competitions/4/declarations') {
  const value = { competition: comp(extra), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] };
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CompetitionContext.Provider value={value}><DeclarationsTab /></CompetitionContext.Provider>
    </MemoryRouter>,
  );
}


function mountDocked(extra: Partial<CompetitionDetail> = {}) {
  const value = { competition: comp(extra), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [] };
  return render(
    <MemoryRouter initialEntries={['/competitions/4/declarations']}>
      <CurrentCompetitionProvider>
        <TickerProvider>
          <CompetitionContext.Provider value={value}><DeclarationsTab /></CompetitionContext.Provider>
          <TopBarTicker />
        </TickerProvider>
      </CurrentCompetitionProvider>
    </MemoryRouter>,
  );
}

const opened = () => screen.findByLabelText('Team name');
const riderRows = () => within(screen.getByRole('list', { name: 'Riders' })).queryAllByRole('listitem');
const addBar = () => screen.getByRole('button', { name: /^(Add rider \d|Add a reserve)$/ });
const agree = () => screen.getByRole('switch', { name: 'I agree to the terms' });

async function fillPanel(user: ReturnType<typeof userEvent.setup>, v: { name: string; dob: string; pony?: string; height?: string }) {
  await user.type(screen.getByLabelText('Rider'), v.name);
  await user.type(screen.getByLabelText('Date of birth'), v.dob);
  if (v.pony !== undefined) await user.type(screen.getByLabelText('Pony'), v.pony);
  if (v.height !== undefined) await user.type(screen.getByLabelText('Height (hh)'), v.height);
}

/** Sets the trainer through the Trainer row's sheet. */
async function setTrainer(user: ReturnType<typeof userEvent.setup>, v: { name?: string; phone?: string }) {
  await user.click(screen.getByRole('button', { name: /^Trainer:/ }));
  const sheet = within(await screen.findByRole('dialog', { name: 'Trainer' }));
  if (v.name !== undefined) { await user.clear(sheet.getByLabelText('Name')); await user.type(sheet.getByLabelText('Name'), v.name); }
  if (v.phone !== undefined) { await user.clear(sheet.getByLabelText('Phone')); await user.type(sheet.getByLabelText('Phone'), v.phone); }
  await user.click(sheet.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trainer' })).not.toBeInTheDocument());
}

beforeEach(() => {
  state.user = { id: 'u1', fullName: 'Alex Morgan', email: 'alex@example.com', clubId: 1, clubName: 'Stockport PC', roles: ['Trainer'] };
  forms = [];
  state.organise = false;
  savedRiders = saved;
  savedTeams = null;
  state.get.mockImplementation(async (url: string) => {
    if (url === '/declaration-forms') return { data: forms };
    if (url.startsWith('/declaration-forms/my-saved-teams') && savedTeams) return { data: savedTeams };
    if (url === '/clubs/1/saved-riders') return { data: savedRiders };
    throw new Error(`unexpected ${url}`);
  });
  state.post.mockImplementation(async (_url: string, body: { teamId: number; riders: unknown[] }) => ({
    data: { id: 50, teamId: body.teamId, teamName: 'Stockport C', competitionId: 4, competitionName: 'Cheshire Area MG', submittedAt: '2026-10-22T10:00:00Z', isLocked: true, riders: [] },
  }));
  state.del.mockResolvedValue({});
});

describe('DeclarationsTab: the dec form', () => {
  it('opens a lone team at once, with a banner, the team card, the riders and one add bar', async () => {
    mount();
    await opened();
    expect(await screen.findByRole('heading', { name: 'Stockport C' })).toBeInTheDocument();
    expect(screen.getByText('U10 · Cheshire Area MG · Sat 24 Oct')).toBeInTheDocument();
    for (const label of ['Team name', 'Bibs', 'Notes']) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Trainer: Alex Morgan/ })).toBeInTheDocument();
    expect(screen.getByText('Not sent yet.')).not.toHaveAttribute('data-tone');
    // Only filled riders are rows; one bar adds the next, and the reserve is offered last.
    expect(riderRows()).toHaveLength(0);
    expect(addBar()).toHaveTextContent('Add rider 1');
    expect(screen.getByText('0 of 5 · 4 needed · reserve optional')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send dec form' })).toBeDisabled();
    expect(screen.getByText('Add 4 more riders to send it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this dec form' })).not.toBeInTheDocument();
    // No rider numbers, order controls or captain, and no helper copy.
    expect(screen.queryByTitle('Captain')).not.toBeInTheDocument();
    expect(screen.queryByText(/captain/i)).not.toBeInTheDocument();
  });

  it('fills a slot from the panel, then opens the next empty slot', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(addBar());
    const panel = screen.getByRole('region', { name: 'Add a rider' });
    expect(within(panel).getByRole('button', { name: 'Add rider' })).toBeDisabled();
    await fillPanel(user, { name: 'Ella Hughes', dob: '05/04/2015', pony: 'Pickle', height: '13.2' });
    await user.click(within(panel).getByRole('button', { name: 'Add rider' }));
    expect(within(riderRows()[0]).getByText('Ella Hughes')).toBeInTheDocument();
    expect(within(riderRows()[0]).getByText('Pickle · 13.2 hh · born 05/04/2015')).toBeInTheDocument();
    expect(screen.getByText('1 of 5 · 4 needed · reserve optional')).toBeInTheDocument();
    expect(screen.getByLabelText('Rider')).toHaveValue('');
    expect(addBar()).toHaveTextContent('Add rider 2');
  });

  it('keeps Add rider off until the date and the height are real', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(addBar());
    const add = screen.getByRole('button', { name: 'Add rider' });
    await fillPanel(user, { name: 'Ella', dob: '31/02/2015', pony: 'Pickle', height: '13.5' });
    expect(add).toBeDisabled();
    expect(screen.getByLabelText('Date of birth')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Height (hh)')).toHaveAttribute('aria-invalid', 'true');
    await user.clear(screen.getByLabelText('Date of birth'));
    await user.type(screen.getByLabelText('Date of birth'), '05/04/2015');
    await user.clear(screen.getByLabelText('Height (hh)'));
    await user.type(screen.getByLabelText('Height (hh)'), '13.2');
    expect(add).toBeEnabled();
  });

  it('fills every field from a saved rider, leaves out anyone already in the team, and lets the name be changed', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(addBar());
    await user.click(screen.getByRole('button', { name: 'Ella Hughes · Pickle' }));
    expect(screen.getByLabelText('Rider')).toHaveValue('Ella Hughes');
    expect(screen.getByLabelText('Date of birth')).toHaveValue('05/04/2015');
    expect(screen.getByLabelText('Pony')).toHaveValue('Pickle');
    expect(screen.getByLabelText('Height (hh)')).toHaveValue('13.2');
    await user.click(screen.getByRole('button', { name: 'Add rider' }));
    expect(screen.queryByRole('button', { name: 'Ella Hughes · Pickle' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Oliver Smith · Bramble' })).toBeInTheDocument();
  });

  async function fillTeam(user: ReturnType<typeof userEvent.setup>) {
    await user.click(addBar());
    for (const name of ['Ella Hughes · Pickle', 'Oliver Smith · Bramble', 'Maisie Clarke · Toffee', 'Harry Wood · Jasper']) {
      await user.click(screen.getByRole('button', { name }));
      await user.click(screen.getByRole('button', { name: 'Add rider' }));
    }
    await fillPanel(user, { name: 'Sam New', dob: '01/02/2016', pony: 'Mist', height: '12.0' });
    await user.click(screen.getByRole('button', { name: 'Add rider' }));
  }

  it('asks the reserve only for a name and date of birth, and copies no pony across', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await fillTeam(user);
    // The reserve is the last slot, so the add bar only offers it once the five riders are in.
    const panel = screen.getByRole('region', { name: 'Add a non-riding reserve' });
    expect(within(panel).queryByLabelText('Pony')).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText('Height (hh)')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Ruby Ash · Domino' }));
    expect(within(panel).getByRole('button', { name: 'Add reserve' })).toBeEnabled();
    await user.click(within(panel).getByRole('button', { name: 'Add reserve' }));
    expect(riderRows()).toHaveLength(6);
    expect(within(riderRows()[5]).getByText('Reserve')).toBeInTheDocument();
    expect(within(riderRows()[5]).getByText('Non-riding · born 14/03/2016')).toBeInTheDocument();
    expect(screen.getByText('5 of 5 · 4 needed · reserve optional')).toBeInTheDocument();
    // Every slot is full, so there is no add bar.
    expect(screen.queryByRole('button', { name: /^(Add rider \d|Add a reserve)$/ })).not.toBeInTheDocument();
  });

  it('edits a filled rider with Save, removes one from its panel, and closes the panel', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(addBar());
    await user.click(screen.getByRole('button', { name: 'Ella Hughes · Pickle' }));
    await user.click(screen.getByRole('button', { name: 'Add rider' }));
    await user.click(within(riderRows()[0]).getByRole('button'));
    const panel = screen.getByRole('region', { name: 'Edit rider' });
    expect(within(panel).queryByText('Pick a saved rider')).not.toBeInTheDocument();
    await user.clear(within(panel).getByLabelText('Pony'));
    await user.type(within(panel).getByLabelText('Pony'), 'Pickles');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(within(riderRows()[0]).getByText('Pickles · 13.2 hh · born 05/04/2015')).toBeInTheDocument();
    await user.click(within(riderRows()[0]).getByRole('button'));
    await user.click(within(screen.getByRole('region', { name: 'Edit rider' })).getByRole('button', { name: 'Remove rider' }));
    expect(riderRows()).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Edit rider' })).not.toBeInTheDocument();
    expect(addBar()).toHaveTextContent('Add rider 1');
    await user.click(addBar());
    expect(within(screen.getByRole('region', { name: 'Add a rider' })).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}'); // on a phone the panel is a sheet with no Close button
    expect(screen.queryByRole('region', { name: 'Add a rider' })).not.toBeInTheDocument();
  });

  it('closes the panel with Escape', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(addBar());
    await user.type(screen.getByLabelText('Rider'), '{Escape}');
    expect(screen.queryByRole('region', { name: 'Add a rider' })).not.toBeInTheDocument();
  });

  it('sends only when the riders are in and the terms are on, and says why not until then', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    const send = screen.getByRole('button', { name: 'Send dec form' });
    await fillTeam(user);
    // The reserve slot opens after the fifth rider; leaving it empty is fine.
    expect(screen.getByRole('region', { name: 'Add a non-riding reserve' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(addBar()).toHaveTextContent('Add a reserve');
    expect(screen.getByText('Agree to the terms to send it.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Team complete' })).toBeInTheDocument();
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText('Bibs'), 'Yellow with navy stars');
    await setTrainer(user, { phone: '07700 900123' });
    expect(screen.getByRole('button', { name: /^Trainer: Alex Morgan · 07700 900123/ })).toBeInTheDocument();
    await user.click(agree());
    expect(screen.getByText('Ready to send.')).toBeInTheDocument();
    expect(send).toBeEnabled();
    await user.click(send);

    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
    const [url, body] = state.post.mock.calls[0];
    expect(url).toBe('/declaration-forms');
    expect(body).toMatchObject({
      teamId: 7, teamName: 'Stockport C', bibDescription: 'Yellow with navy stars', trainerName: 'Alex Morgan', trainerPhone: '07700 900123',
      notes: null, saveToRoster: true, acceptTerms: true,
    });
    expect(body.riders).toHaveLength(5);
    expect(body.riders[0]).toMatchObject({ savedRiderId: 1, fullName: 'Ella Hughes', dateOfBirth: '2015-04-05', horseName: 'Pickle', ponyHeightHands: 13.2, isCaptain: false, isReserve: false, orderIndex: 0 });
    expect(body.riders[4]).toMatchObject({ savedRiderId: null, fullName: 'Sam New', dateOfBirth: '2016-02-01', ponyHeightHands: 12 });
    expect(await screen.findByText('Declaration form sent. You can still change it.')).toBeInTheDocument();
    expect(screen.getByText('Sent. You can still change it.')).toHaveAttribute('data-tone', 'good');
    expect(screen.getByRole('button', { name: 'Send changes' })).toBeDisabled();
    expect(screen.getByText('Nothing has changed since you sent it.')).toBeInTheDocument();
    // The saved form replaces just this team's on screen; the list isn't fetched again.
    expect(state.get.mock.calls.filter(([path]) => path === '/declaration-forms')).toHaveLength(1);
  });

  it('lets the form be sent again after a change', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await fillTeam(user);
    await user.click(agree());
    await user.click(screen.getByRole('button', { name: 'Send dec form' }));
    await screen.findByText('Declaration form sent. You can still change it.');
    await user.type(screen.getByLabelText('Notes'), 'Late arrival');
    expect(screen.getByRole('button', { name: 'Send changes' })).toBeEnabled();
    expect(screen.getByText('Sending again replaces the last one.')).toBeInTheDocument();
  });

  it('shows the API\'s reason when the form is refused, and keeps the work', async () => {
    state.post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'A saved rider is not available to this account.' } } });
    const user = userEvent.setup();
    mount();
    await opened();
    await fillTeam(user);
    await user.click(agree());
    await user.click(screen.getByRole('button', { name: 'Send dec form' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A saved rider is not available to this account.');
    expect(screen.getByRole('button', { name: 'Send dec form' })).toBeEnabled();
    expect(within(riderRows()[0]).getByText('Ella Hughes')).toBeInTheDocument();
  });

  it('falls back to a plain message when there was no signal', async () => {
    state.post.mockRejectedValueOnce(new Error('Network Error'));
    const user = userEvent.setup();
    mount();
    await opened();
    await fillTeam(user);
    await user.click(agree());
    await user.click(screen.getByRole('button', { name: 'Send dec form' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t send the declaration form. Check your signal and try again.');
  });

  it('sends the form again from Try again in the problem strip', async () => {
    state.post.mockRejectedValueOnce(new Error('Network Error'));
    const user = userEvent.setup();
    mount();
    await opened();
    await fillTeam(user);
    await user.click(agree());
    await user.click(screen.getByRole('button', { name: 'Send dec form' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('shows the organiser\'s own terms behind the link, and a labelled placeholder when there are none', async () => {
    const user = userEvent.setup();
    const { unmount } = mount();
    await opened();
    await user.click(screen.getByRole('button', { name: 'terms' }));
    const dialog = screen.getByRole('dialog', { name: 'Terms and conditions' });
    expect(dialog).toHaveTextContent('Hats must be worn.');
    expect(dialog).toHaveTextContent('No bare feet.');
    expect(agree()).toHaveAttribute('aria-checked', 'false');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    unmount();

    mount({ termsText: '   ' });
    await opened();
    await user.click(await screen.findByRole('button', { name: 'terms' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/Placeholder\./);
  });

  it('keeps the trainer sheet honest: a name is needed, and a bad phone number is refused', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(screen.getByRole('button', { name: /^Trainer:/ }));
    const sheet = within(await screen.findByRole('dialog', { name: 'Trainer' }));
    expect(sheet.getByLabelText('Name')).toHaveValue('Alex Morgan');
    await user.clear(sheet.getByLabelText('Name'));
    expect(sheet.getByRole('button', { name: 'Done' })).toBeDisabled();
    await user.type(sheet.getByLabelText('Name'), 'Jo Hughes');
    await user.type(sheet.getByLabelText('Phone'), '12345');
    expect(sheet.getByText('Enter a UK or Irish number, like 07123 456789.')).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Done' })).toBeDisabled();
    await user.clear(sheet.getByLabelText('Phone'));
    await user.type(sheet.getByLabelText('Phone'), '07123 456789{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trainer' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Trainer: Jo Hughes · 07123 456789. Change it' })).toBeInTheDocument();
  });

  it('picks a flag for the team from the Flag row', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(screen.getByRole('button', { name: 'Flag: No flag' }));
    await user.click(screen.getByRole('option', { name: 'England' }));
    expect(screen.getByRole('button', { name: 'Flag: England' })).toBeInTheDocument();
  });

  it('opens an existing declaration for editing, with the saved details and the sent banner', async () => {
    forms = [{
      id: 9, teamId: 7, teamName: 'Stockport C', competitionId: 4, competitionName: 'Cheshire Area MG', submittedByUserId: 'u1', submittedByName: 'Alex Morgan',
      submittedByPhone: '07700 900123', submittedAt: '2026-10-20T09:00:00Z', notes: 'Early start please', isLocked: true, bibDescription: 'Blue bibs',
      trainerName: 'Jo Hughes',
      riders: [
        { id: 1, fullName: 'Ella Hughes', dateOfBirth: '2015-04-05T00:00:00', horseName: 'Pickle', ponyHeightHands: 13.2, isCaptain: true, isReserve: false, orderIndex: 0, savedRiderId: 1 },
        { id: 2, fullName: 'Reserve Rita', dateOfBirth: '2016-01-02T00:00:00', isCaptain: false, isReserve: true, orderIndex: 5 },
      ],
    }];
    mount();
    await opened();
    expect(await screen.findByText('Sent. You can still change it.')).toBeInTheDocument();
    expect(screen.getByLabelText('Team name')).toHaveValue('Stockport C');
    expect(screen.getByLabelText('Bibs')).toHaveValue('Blue bibs');
    expect(screen.getByRole('button', { name: 'Trainer: Jo Hughes · 07700 900123. Change it' })).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('Early start please');
    expect(within(riderRows()[0]).getByText('Pickle · 13.2 hh · born 05/04/2015')).toBeInTheDocument();
    expect(within(riderRows()[1]).getByText('Non-riding · born 02/01/2016')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete this dec form' })).toBeInTheDocument();
  });

  it('says when a sent form can still be changed, and by when to send an unsent one', async () => {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/declaration-forms') return { data: forms };
      if (url === '/clubs/1/saved-riders') return { data: savedRiders };
      if (url === '/declaration-forms/competition/4/lock-time') return { data: { competitionId: 4, declarationsCloseAt: '2040-10-26T17:00:00Z', isClosed: false } };
      throw new Error(`unexpected ${url}`);
    });
    const { unmount } = mount();
    expect(await screen.findByText(/^Send by /)).not.toHaveAttribute('data-tone');
    unmount();
    forms = [{ id: 9, teamId: 7, teamName: 'Stockport C', competitionId: 4, competitionName: 'x', submittedByUserId: 'u1', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders: [] }];
    mount();
    expect(await screen.findByText(/^Sent\. You can change it until /)).toHaveAttribute('data-tone', 'good');
  });

  it('deletes a sent dec form from the editor, after asking, and goes back to not sent', async () => {
    forms = [{ id: 9, teamId: 7, teamName: 'Stockport C', competitionId: 4, competitionName: 'x', submittedByUserId: 'u1', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders: [] }];
    const user = userEvent.setup();
    mount();
    await opened();
    const asked = autoConfirm([false, true]);
    await user.click(await screen.findByRole('button', { name: 'Delete this dec form' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('The declaration form for Stockport C goes for good.'));
    expect(state.del).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete this dec form' }));
    await waitFor(() => expect(state.del).toHaveBeenCalledWith('/declaration-forms/9'));
    expect(await screen.findByText('Not sent yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send dec form' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this dec form' })).not.toBeInTheDocument();
  });

  it('keeps the captain flag and privacy choices of a rider it does not show', async () => {
    forms = [{
      id: 9, teamId: 7, teamName: 'Stockport C', competitionId: 4, competitionName: 'Cheshire Area MG', submittedAt: '2026-10-20T09:00:00Z', isLocked: true,
      riders: [0, 1, 2, 3, 4].map((i) => ({
        id: i + 1, fullName: `Rider ${i + 1}`, dateOfBirth: '2015-04-05T00:00:00', horseName: 'Pony', ponyHeightHands: 13, isCaptain: i === 0, isReserve: false, orderIndex: i,
        useInitialOnly: i === 2,
      })),
    }];
    const user = userEvent.setup();
    mount();
    await opened();
    await screen.findByText('Sent. You can still change it.');
    await user.click(agree());
    await user.type(screen.getByLabelText('Notes'), 'x');
    await user.click(screen.getByRole('button', { name: 'Send changes' }));
    await waitFor(() => expect(state.post).toHaveBeenCalled());
    const riders = state.post.mock.calls[0][1].riders;
    expect(riders[0].isCaptain).toBe(true);
    expect(riders[2].useInitialOnly).toBe(true);
  });

  it('needs only two riders for a pair and one for an individual, with no reserve slot', async () => {
    mount({ teams: [team(8, { competitionId: 4, competitionSectionId: 6, clubId: 1, displayName: 'Pair A', trainerUserId: 'u1' })] });
    expect(await screen.findByText('0 of 2')).toBeInTheDocument();
    expect(addBar()).toHaveTextContent('Add rider 1');
    expect(screen.getByText('Add 2 more riders to send it.')).toBeInTheDocument();
  });

  it('allows a four-rider team to send without a fifth rider', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(addBar());
    for (const name of ['Ella Hughes · Pickle', 'Oliver Smith · Bramble', 'Maisie Clarke · Toffee', 'Harry Wood · Jasper']) {
      await user.click(screen.getByRole('button', { name }));
      await user.click(screen.getByRole('button', { name: 'Add rider' }));
    }
    await user.click(agree());
    const send = screen.getByRole('button', { name: 'Send dec form' });
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
    expect(state.post.mock.calls[0][1].riders).toHaveLength(4);
  });

  it('displays multiple saved (Rider — Horse) combinations for the same rider and selects the chosen horse', async () => {
    const user = userEvent.setup();
    savedRiders = [
      { id: 1, clubId: 1, fullName: 'Ella Hughes', dateOfBirth: '2015-04-05T00:00:00', horseName: 'Pickle', ponyHeightHands: 13.2 },
      { id: 7, clubId: 1, fullName: 'Ella Hughes', dateOfBirth: '2015-04-05T00:00:00', horseName: 'Flash', ponyHeightHands: 14.0 },
    ];
    mount();
    await opened();
    await user.click(addBar());
    expect(screen.getByRole('button', { name: 'Ella Hughes · Pickle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ella Hughes · Flash' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ella Hughes · Flash' }));
    expect(screen.getByLabelText('Rider')).toHaveValue('Ella Hughes');
    expect(screen.getByLabelText('Pony')).toHaveValue('Flash');
    expect(screen.getByLabelText('Height (hh)')).toHaveValue('14.0');
  });

  it('lets organisers set and clear the deadline from a date row, and reports failed saves', async () => {
    state.user!.roles = ['Admin'];
    const user = userEvent.setup();
    const lockUrl = '/declaration-forms/competition/4/lock-time';
    state.put.mockResolvedValueOnce({ data: { competitionId: 4, declarationsCloseAt: '2026-10-23T09:00:00.000Z', isClosed: false } });
    mount();
    await opened();
    await user.click(screen.getByRole('button', { name: 'Dec forms close: Not set' }));
    const calendar = within(screen.getByRole('dialog', { name: 'Dec forms close' }));
    await user.click(calendar.getByRole('gridcell', { name: 'Saturday 24 October' }));
    await user.click(calendar.getByRole('button', { name: 'Done' }));
    expect(state.put).toHaveBeenCalledWith(lockUrl, { declarationsCloseAt: new Date(2026, 9, 24, 9, 0).toISOString() });

    const row = await screen.findByRole('button', { name: /^Dec forms close: (?!Not set)/ });
    state.put.mockRejectedValueOnce(new Error('offline'));
    await user.click(row);
    await user.click(within(screen.getByRole('dialog', { name: 'Dec forms close' })).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the dec form deadline. Check your signal and try again.');
    state.put.mockResolvedValueOnce({ data: { competitionId: 4, declarationsCloseAt: null, isClosed: false } });
    await user.click(screen.getByRole('button', { name: /^Dec forms close: (?!Not set)/ }));
    await user.click(within(screen.getByRole('dialog', { name: 'Dec forms close' })).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dec forms close: Not set' })).toBeInTheDocument());
    expect(state.put).toHaveBeenLastCalledWith(lockUrl, { declarationsCloseAt: null });
  });

  it('shows the declaration deadline banner and blocks non-organiser edits after the lock time passes', async () => {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/declaration-forms') return { data: forms };
      if (url === '/clubs/1/saved-riders') return { data: savedRiders };
      if (url === '/declaration-forms/competition/4/lock-time') {
        return { data: { competitionId: 4, declarationsCloseAt: '2020-01-01T10:00:00Z', isClosed: true } };
      }
      throw new Error(`unexpected ${url}`);
    });
    mount();
    expect(await screen.findByText(/Declaration forms closed on 1 Jan\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Message the organisers' })).toHaveAttribute('href', '/competitions/4/contact');
    expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument();
  });

  it('lets a self-entered Rider open and submit a dec form for their linked team', async () => {
    state.user = { id: 'u-rider', fullName: 'Sam Rider', email: 'sam@example.com', clubId: null, clubName: '', roles: ['Rider'] };
    state.get.mockImplementation(async (url: string) => {
      if (url === '/declaration-forms') return { data: forms };
      if (url === '/me/signups') return { data: [{ id: 101, competitionId: 4, competitionSectionId: 6, teamId: 8, fullName: 'Sam Rider', status: 1, declarationAccessGranted: true }] };
      if (url === '/clubs/1/saved-riders') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    mount({ teams: [team(8, { competitionId: 4, competitionSectionId: 6, clubId: 1, displayName: 'Sam Rider & Pat Lee', trainerUserId: null })] });
    expect(await screen.findByRole('heading', { name: 'Sam Rider & Pat Lee' })).toBeInTheDocument();
  });

  it('lets the trainer pick between teams, and takes ?team= from the profile link', async () => {
    const user = userEvent.setup();
    const teams = [
      team(7, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport C', trainerUserId: 'u1' }),
      team(8, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport D', trainerUserId: 'u1' }),
      team(9, { competitionId: 4, competitionSectionId: 5, clubId: 2, displayName: 'Someone Else', trainerUserId: 'u2' }),
    ];
    mount({ teams }, '/competitions/4/declarations?team=8');
    expect(await screen.findByRole('heading', { name: 'Stockport D' })).toBeInTheDocument();
    const choose = within(screen.getByRole('group', { name: 'Choose a team' }));
    expect(choose.queryByRole('button', { name: 'Someone Else' })).not.toBeInTheDocument();
    expect(choose.getByRole('button', { name: 'Stockport D' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(choose.getByRole('button', { name: 'Stockport C' }));
    expect(screen.getByRole('heading', { name: 'Stockport C' })).toBeInTheDocument();
  });

  it('opens nothing by itself when there are several teams and no hint', async () => {
    const teams = [
      team(7, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport C', trainerUserId: 'u1' }),
      team(8, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport D', trainerUserId: 'u1' }),
    ];
    mount({ teams });
    await screen.findByRole('group', { name: 'Choose a team' });
    expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument();
  });

  it('shows a team manager every team of their club', async () => {
    state.user = { ...state.user!, id: 'u9', roles: ['Manager'] };
    const teams = [
      team(7, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport C', trainerUserId: 'u1' }),
      team(9, { competitionId: 4, competitionSectionId: 5, clubId: 2, displayName: 'Someone Else', trainerUserId: 'u2' }),
    ];
    mount({ teams });
    expect(await screen.findByRole('heading', { name: 'Stockport C' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Someone Else' })).not.toBeInTheDocument();
  });

  it('ticks a team that already has a form in the picker', async () => {
    forms = [{ id: 9, teamId: 8, teamName: 'Stockport D', competitionId: 4, competitionName: 'x', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders: [] }];
    const teams = [
      team(7, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport C', trainerUserId: 'u1' }),
      team(8, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport D', trainerUserId: 'u1' }),
    ];
    mount({ teams });
    const choose = within(await screen.findByRole('group', { name: 'Choose a team' }));
    expect(choose.getByRole('button', { name: 'Stockport D' }).querySelector('svg')).not.toBeNull();
    expect(choose.getByRole('button', { name: 'Stockport C' }).querySelector('svg')).toBeNull();
  });
});

describe('DeclarationsTab: drafts', () => {
  it('keeps nothing until something is typed', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Stockport C' });
    expect(localStorage.getItem(decDraftKey(4, 7, 'u1'))).toBeNull();
  });

  it('keeps work in progress on the device, and brings it back with the same team open', async () => {
    const user = userEvent.setup();
    const first = mount();
    await user.type(await screen.findByLabelText('Bibs'), 'Green stripes');
    await user.click(addBar());
    await user.click(screen.getByRole('button', { name: 'Ella Hughes · Pickle' }));
    await user.click(screen.getByRole('button', { name: 'Add rider' }));
    expect(JSON.parse(localStorage.getItem(decDraftKey(4, 7, 'u1'))!)).toMatchObject({ teamId: 7, bibs: 'Green stripes' });
    first.unmount();

    mount();
    expect(await screen.findByDisplayValue('Green stripes')).toBeInTheDocument();
    expect(within(riderRows()[0]).getByText('Ella Hughes')).toBeInTheDocument();
    expect(screen.queryByText('Declaration form sent. You can still change it.')).not.toBeInTheDocument();
  });

  it('forgets the draft once the form has gone in', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText('Bibs'), 'Green');
    expect(localStorage.getItem(decDraftKey(4, 7, 'u1'))).not.toBeNull();
    await user.click(addBar());
    for (const name of ['Ella Hughes · Pickle', 'Oliver Smith · Bramble', 'Maisie Clarke · Toffee', 'Harry Wood · Jasper', 'Ruby Ash · Domino']) {
      await user.click(screen.getByRole('button', { name }));
      await user.click(screen.getByRole('button', { name: 'Add rider' }));
    }
    await user.click(agree());
    await user.click(screen.getByRole('button', { name: 'Send dec form' }));
    await screen.findByText('Declaration form sent. You can still change it.');
    expect(localStorage.getItem(decDraftKey(4, 7, 'u1'))).toBeNull();
  });

  it('ignores a draft that does not fit the team', async () => {
    localStorage.setItem(decDraftKey(4, 7, 'u1'), JSON.stringify({ teamId: 7, slots: [null, null] }));
    mount();
    expect(await screen.findByText('0 of 5 · 4 needed · reserve optional')).toBeInTheDocument();
  });

  it('survives a device that will not store drafts', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    mount();
    await user.type(await screen.findByLabelText('Bibs'), 'Green');
    expect(screen.getByLabelText('Bibs')).toHaveValue('Green');
  });
});

describe('DeclarationsTab: around the form', () => {
  it('asks a visitor to sign in with one plain line and an outlined pill, not a banner', async () => {
    state.user = null;
    mount();
    const pill = await screen.findByRole('link', { name: 'Sign in' });
    expect(pill).toHaveAttribute('href', '/login');
    expect(pill).toHaveClass('sp-pill');
    expect(screen.getByText('Trainers sign in to send declaration forms for their teams.')).toBeInTheDocument();
    expect(document.querySelector('.mg-notice')).toBeNull();
    expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument();
  });

  it('leaves Export CSV off the public page, and keeps it for organisers', async () => {
    forms = [{ id: 9, teamId: 70, teamName: 'Other Club A', competitionId: 4, competitionName: 'x', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders: [] }];
    const view = mount();
    await screen.findByRole('button', { name: /^Other Club A/ });
    expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument();
    view.unmount();
    state.organise = true;
    mount();
    expect(await screen.findByRole('button', { name: /Export CSV \(1\)/ })).toBeInTheDocument();
  });

  it('shows how many dec forms are in, a QR code for the page, and Export CSV at the bottom', async () => {
    forms = [{ id: 9, teamId: 70, teamName: 'Other Club A', competitionId: 4, competitionName: 'x', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders: [] }];
    state.organise = true;
    mount();
    const exportButton = await screen.findByRole('button', { name: /Export CSV \(1\)/ });
    expect(await screen.findByText(/^\d+ of \d+ dec forms? in$/)).toBeInTheDocument();
    const qrRow = screen.getByRole('button', { name: 'Show dec form QR code' });
    expect(screen.queryByRole('img', { name: /QR code for the/ })).not.toBeInTheDocument();
    await userEvent.setup().click(qrRow);
    expect(screen.getByRole('img', { name: /QR code for the/ })).toBeInTheDocument();
    // Export comes after the list of forms and the QR row, not before them.
    expect(qrRow.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Other Club A/ }).compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says so when the person has no team here', async () => {
    mount({ teams: [] });
    expect(await screen.findByText('You have no teams in this competition.')).toBeInTheDocument();
  });

  it('lists the forms already sent, and opens one in place to show its riders and ponies, with no captain star', async () => {
    forms = [{
      id: 9, teamId: 70, teamName: 'Other Club A', competitionId: 4, competitionName: 'Cheshire Area MG', submittedByName: 'Pat Lee', trainerName: 'Jo Hughes',
      submittedByPhone: '0777', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, bibDescription: 'Red bibs', notes: 'Hello',
      riders: [
        { id: 1, fullName: 'Ella Hughes', horseName: 'Pickle', ponyHeightHands: 13.2, isCaptain: true, isReserve: false, isGuestRider: true, orderIndex: 0 },
        { id: 2, fullName: 'Rita Reserve', isCaptain: false, isReserve: true, orderIndex: 1 },
      ],
    }];
    const user = userEvent.setup();
    mount();
    const row = await screen.findByRole('button', { name: /^Other Club A/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row).toHaveTextContent('Sent 20 Oct');
    expect(screen.queryByText('Ella Hughes')).not.toBeInTheDocument();
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(row.getAttribute('aria-controls')!) as HTMLElement;
    expect(within(panel).getByText('Ella Hughes')).toBeInTheDocument();
    expect(within(panel).getByText('Pickle · 13.2 hh')).toBeInTheDocument();
    expect(within(panel).getByText('Guest')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Reserve')).toBeInTheDocument();
    expect(within(panel).getByText('Bibs: Red bibs')).toBeInTheDocument();
    expect(within(panel).getByText('Jo Hughes')).toBeInTheDocument();
    expect(within(panel).getByText('“Hello”')).toBeInTheDocument();
    expect(panel.querySelector('.fill-amber-500')).toBeNull();
    await user.click(row);
    expect(screen.queryByText('Ella Hughes')).not.toBeInTheDocument();
  });

  it('groups the forms by age group and searches by team, rider or pony', async () => {
    const form = (id: number, teamId: number, teamName: string, rider: string, pony: string): DeclarationForm => ({
      id, teamId, teamName, competitionId: 4, competitionName: 'x', submittedAt: '2026-10-20T09:00:00Z', isLocked: true,
      riders: [{ id, fullName: rider, horseName: pony, isCaptain: false, isReserve: false, orderIndex: 0 }],
    });
    forms = [form(1, 71, 'Zebras', 'Ann Lee', 'Toffee'), form(2, 72, 'Aardvarks', 'Bo Park', 'Dandy'), form(3, 73, 'Lone Rangers', 'Cy Ford', 'Pip')];
    const user = userEvent.setup();
    mount({
      teams: [team(71, { competitionSectionId: 5 }), team(72, { competitionSectionId: 5 }), team(73, { competitionSectionId: 6 }), team(7, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport C', trainerUserId: 'u1' })],
    });
    const u10 = await screen.findByRole('region', { name: 'U10' });
    expect(within(u10).getAllByRole('button').map((b) => b.textContent)).toEqual(['AardvarksSent 20 Oct', 'ZebrasSent 20 Oct']);
    expect(within(screen.getByRole('region', { name: 'U12 Pairs' })).getByRole('button', { name: /^Lone Rangers/ })).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Find a team, rider or pony' });
    await user.type(search, 'dandy');
    expect(screen.getByRole('button', { name: /^Aardvarks/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Zebras/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'U12 Pairs' })).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'nobody');
    expect(screen.getByText('No declaration form matches “nobody”.')).toBeInTheDocument();
  });

  it('puts a form for a team that is not in the list under Other', async () => {
    forms = [{ id: 1, teamId: 999, teamName: 'Lost Team', competitionId: 4, competitionName: 'x', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders: [] }];
    mount();
    expect(within(await screen.findByRole('region', { name: 'Other' })).getByRole('button', { name: /^Lost Team/ })).toBeInTheDocument();
  });

  it('says so before any form has been sent', async () => {
    mount();
    expect(await screen.findByText('No declaration forms submitted yet.')).toBeInTheDocument();
  });

  it('removes a form from the list when it is deleted by an authorised user, and hides delete for other clubs', async () => {
    const user = userEvent.setup();
    forms = [
      { id: 9, teamId: 7, teamName: 'Stockport C', competitionId: 4, competitionName: 'x', submittedByUserId: 'u1', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders: [] },
      { id: 10, teamId: 70, teamName: 'Other Club A', competitionId: 4, competitionName: 'x', submittedByUserId: 'u-other', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders: [] },
    ];
    mount();
    await user.click(await screen.findByRole('button', { name: /^Other Club A/ }));
    expect(screen.queryByRole('button', { name: 'Delete the declaration form for Other Club A' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Stockport C.*Sent/ }));
    const asked = autoConfirm([false, true]);
    await user.click(await screen.findByRole('button', { name: 'Delete the declaration form for Stockport C' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('The declaration form for Stockport C goes for good.'));
    expect(state.del).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete the declaration form for Stockport C' }));
    await waitFor(() => expect(state.del).toHaveBeenCalledWith('/declaration-forms/9'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete the declaration form for Stockport C' })).not.toBeInTheDocument());
  });

  it('says so when a dec form could not be deleted, and keeps it in the list', async () => {
    const user = userEvent.setup();
    forms = [{ id: 9, teamId: 7, teamName: 'Stockport C', competitionId: 4, competitionName: 'x', submittedByUserId: 'u1', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, riders: [] }];
    state.del.mockRejectedValueOnce(new Error('offline'));
    mount();
    autoConfirm(true);
    await user.click(await screen.findByRole('button', { name: /^Stockport C.*Sent/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete the declaration form for Stockport C' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t delete the declaration form. Check your signal and try again.');
    expect(screen.getByRole('button', { name: 'Delete the declaration form for Stockport C' })).toBeInTheDocument();
  });

  it('exports the forms as a CSV with height and trainer columns', async () => {
    const user = userEvent.setup();
    forms = [{
      id: 9, teamId: 70, teamName: 'Other Club A', competitionId: 4, competitionName: 'x', submittedByName: 'Pat Lee', trainerName: 'Jo Hughes',
      submittedAt: '2026-10-20T09:00:00Z', termsAcceptedAt: '2026-10-20T09:00:00Z', isLocked: true, bibDescription: 'Red bibs',
      riders: [
        { id: 1, fullName: 'Ella Hughes', dateOfBirth: '2015-04-05T00:00:00', horseName: 'Pickle', ponyHeightHands: 13.2, isCaptain: false, isReserve: false, orderIndex: 0 },
        { id: 2, fullName: 'Rita Reserve', isCaptain: false, isReserve: true, orderIndex: 1 },
      ],
    }];
    state.organise = true;
    mount();
    await user.click(await screen.findByRole('button', { name: /Export CSV \(1\)/ }));
    const [filename, csv] = state.download.mock.calls[0];
    expect(filename).toBe('Cheshire_Area_MG-dec-forms.csv');
    const lines = String(csv).split('\n');
    expect(lines[0]).toContain('Height (hh)');
    expect(lines[0]).not.toContain('Captain');
    expect(lines[1]).toContain('Ella Hughes');
    expect(lines[1]).toContain('05/04/2015');
    expect(lines[1]).toContain('13.2');
    expect(lines[1]).toContain('Jo Hughes');
    expect(lines[2]).toContain('yes');
  });

  it('copes with the forms not loading', async () => {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/declaration-forms') throw new Error('offline');
      return { data: savedRiders };
    });
    mount();
    expect(await screen.findByRole('heading', { name: 'Stockport C' })).toBeInTheDocument();
    expect(screen.getByText('No declaration forms submitted yet.')).toBeInTheDocument();
  });

  it('carries on without the saved riders', async () => {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/declaration-forms') return { data: forms };
      throw new Error('offline');
    });
    const user = userEvent.setup();
    mount();
    await screen.findByRole('heading', { name: 'Stockport C' });
    await user.click(addBar());
    expect(screen.queryByText('Pick a saved rider')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rider')).toBeInTheDocument();
  });
});

it.each([true, false])('only opens a secondary signup team when the trusted grant is %s', async (granted) => {
  state.user = { ...state.user!, id: 'synthetic-member', clubId: null, roles: ['Member'] };
  state.get.mockImplementation(async (url: string) => ({ data: url === '/me/signups' ? [{ id: 101, competitionId: 4, competitionSectionId: 5, teamId: 7, linkedTeams: [{ id: 7, name: 'Synthetic A' }, { id: 8, name: 'Synthetic B' }], status: 1, declarationAccessGranted: granted }] : [] }));
  mount({ teams: [team(7, { competitionId: 4, competitionSectionId: 5, trainerUserId: null }), team(8, { competitionId: 4, competitionSectionId: 5, displayName: 'Synthetic B', trainerUserId: null })] }, '/competitions/4/declarations?team=8');
  await waitFor(() => expect(state.get).toHaveBeenCalledWith('/me/signups'));
  if (granted) expect(await screen.findByRole('heading', { name: 'Synthetic B' })).toBeInTheDocument();
  else expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument();
});

const rider = (id: number, fullName: string, dateOfBirth: string, horseName: string, extra: Partial<SavedTeamDeclaration['riders'][number]> = {}) => ({
  id, fullName, dateOfBirth, horseName, ponyHeightHands: 13, isCaptain: false, isReserve: false, orderIndex: id, ...extra,
});

const kentA: SavedTeamDeclaration = {
  teamId: 90, teamName: 'Kent A', entryTeamName: 'Kent A', clubName: 'Kent PC', sectionName: 'U10', ageGroup: 'U10', format: 2,
  competitionId: 30, competitionName: 'Spring Friendly', submittedAt: '2026-04-12T09:00:00Z', bibDescription: 'Red with white stars',
  trainerName: 'Sam Lee', trainerPhone: '07700 900111',
  riders: [
    rider(1, 'Amy Fox', '2017-02-01T00:00:00', 'Biscuit'),
    rider(2, 'Ben Fox', '2016-05-01T00:00:00', 'Cobweb'),
    rider(3, 'Cara Hill', '2017-07-01T00:00:00', 'Dandy'),
    rider(4, 'Dan Hill', '2010-09-01T00:00:00', 'Echo'),
    rider(5, 'Eve Moss', '2018-01-01T00:00:00', 'Fudge', { isReserve: true }),
  ],
};

describe('DeclarationsTab: copy a previous team', () => {
  it('fills the riders, bibs and trainer from a team sent before, and warns about a rider too old for the section', async () => {
    savedTeams = [kentA, { ...kentA, teamId: 91, competitionId: 31, riders: [] }];
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(await screen.findByRole('button', { name: /Copy a previous team/ }));
    const sheet = within(await screen.findByRole('dialog', { name: 'Copy a previous team' }));
    // A team with no riders is left out.
    expect(sheet.getAllByRole('listitem')).toHaveLength(1);
    expect(sheet.getByText('Sent 12 Apr 2026')).toBeInTheDocument();
    await user.click(sheet.getByRole('button', { name: /Kent A · U10 · Spring Friendly \(4 riders \+ reserve\)/ }));

    await waitFor(() => expect(riderRows()).toHaveLength(5));
    expect(within(riderRows()[0]).getByText('Amy Fox')).toBeInTheDocument();
    expect(screen.getByLabelText('Bibs')).toHaveValue('Red with white stars');
    // The team keeps its own name for this competition.
    expect(screen.getByLabelText('Team name')).toHaveValue('Stockport C');
    expect(screen.getByRole('button', { name: /^Trainer: Sam Lee/ })).toBeInTheDocument();
    expect(screen.getByText('Copied from Kent A. Check each rider before you send.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Dan Hill turns 16 in 2026 (check U10 eligibility).');
  });

  it('asks before replacing riders already on the form, and lists every warning when there are several', async () => {
    savedTeams = [{ ...kentA, riders: kentA.riders.map((r) => ({ ...r, dateOfBirth: '2009-01-01T00:00:00' })) }];
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(addBar());
    await fillPanel(user, { name: 'Ella Hughes', dob: '05/04/2015', pony: 'Pickle', height: '13.2' });
    await user.click(within(screen.getByRole('region', { name: 'Add a rider' })).getByRole('button', { name: 'Add rider' }));

    autoConfirm(false);
    await user.click(screen.getByRole('button', { name: /Copy a previous team/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Copy a previous team' })).getByRole('button', { name: /Kent A/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Copy a previous team' })).not.toBeInTheDocument());
    expect(riderRows()).toHaveLength(1);

    autoConfirm(true);
    await user.click(screen.getByRole('button', { name: /Copy a previous team/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Copy a previous team' })).getByRole('button', { name: /Kent A/ }));
    await waitFor(() => expect(riderRows()).toHaveLength(5));
    expect(screen.getByRole('alert')).toHaveTextContent('Some riders may be too old for this section:');
    expect(within(screen.getByRole('alert')).getAllByRole('listitem')).toHaveLength(5);
  });

  it('is not offered when there are no earlier teams', async () => {
    savedTeams = [];
    mount();
    await opened();
    expect(screen.queryByRole('button', { name: /Copy a previous team/ })).not.toBeInTheDocument();
  });
});

describe('DeclarationsTab: organiser tools in the dock', () => {
  it('moves the deadline, QR code and export into a sheet for organisers', async () => {
    state.user!.roles = ['Admin'];
    const user = userEvent.setup();
    mountDocked();
    await opened();
    expect(screen.queryByRole('button', { name: /^Dec forms close/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show dec form QR code' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dec form tools' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'Dec form tools' }));
    expect(sheet.getByRole('button', { name: 'Dec forms close: Not set' })).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Show dec form QR code' })).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: /Export CSV \(0\)/ })).toBeDisabled();
  });

  it('opens an organiser on the search, and picks the team to fill in from the sheet', async () => {
    state.user!.roles = ['Admin'];
    const user = userEvent.setup();
    mountDocked({ teams: [
      team(7, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport C', trainerUserId: 'u1' }),
      team(8, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport D', trainerUserId: null }),
    ] });
    await user.click(await screen.findByRole('button', { name: 'Dec form tools' }));
    expect(screen.queryByRole('group', { name: 'Choose a team' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument();
    const sheet = within(await screen.findByRole('dialog', { name: 'Dec form tools' }));
    chooseOption(sheet.getByRole('button', { name: /^Fill in a form for/ }), 'Stockport D');
    expect(await screen.findByLabelText('Team name')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dec form tools' })).not.toBeInTheDocument());
  });

  it('keeps the QR code on the page for a trainer and puts nothing in the dock', async () => {
    mountDocked();
    await opened();
    expect(screen.getByRole('button', { name: 'Show dec form QR code' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dec form tools' })).not.toBeInTheDocument();
  });
});

describe('declaration security privacy controls', () => {
  it('defaults children to initials and preserves a deliberate opt-out during date edits', async () => {
    const user = userEvent.setup();
    mount(); await opened();
    await user.click(addBar());
    const control = screen.getByRole('switch', { name: 'Show surname as initial only on public start lists and results' });
    await user.type(screen.getByLabelText('Date of birth'), '01/01/2015');
    expect(control).toHaveAttribute('aria-checked', 'true');
    await user.click(control);
    await user.clear(screen.getByLabelText('Date of birth'));
    await user.type(screen.getByLabelText('Date of birth'), '02/01/2015');
    expect(control).toHaveAttribute('aria-checked', 'false');
  });

  it('does not restore the previous account’s draft after switching users', async () => {
    const user = userEvent.setup();
    const view = mount(); await opened();
    await user.type(screen.getByLabelText('Bibs'), 'Fake private draft');
    expect(localStorage.getItem(decDraftKey(4, 7, 'u1'))).toContain('Fake private draft');
    view.unmount();
    state.user = { ...state.user!, id: 'u2' }; state.organise = true;
    mount(); await opened();
    expect(screen.getByLabelText('Bibs')).toHaveValue('');
  });
});
