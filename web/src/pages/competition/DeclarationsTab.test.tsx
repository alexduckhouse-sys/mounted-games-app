import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompetitionDetail, DeclarationForm, Role, SavedRider } from '../../types';
import { competition, team } from '../../test/factories';
import { decDraftKey } from '../../lib/decForm';
import { CompetitionContext } from './context';
import { DeclarationsTab } from './DeclarationsTab';
import { autoConfirm } from '../../test/confirm';

const state = vi.hoisted(() => ({
  user: { id: 'u1', fullName: 'Alex Morgan', email: 'alex@example.com', clubId: 1, clubName: 'Stockport PC', roles: ['Trainer'] } as { id: string; fullName: string; email: string; clubId: number | null; clubName: string; roles: Role[] } | null,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  download: vi.fn(),
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: state.user,
    hasRole: (role: Role) => !!state.user?.roles.includes(role),
    canOrganise: () => false,
  }),
}));
vi.mock('../../api', () => ({ api: { get: state.get, post: state.post, put: state.put, delete: state.del } }));
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

const opened = () => screen.findByLabelText('Team name');
const slotButtons = () => within(screen.getByRole('list', { name: 'Riders' })).getAllByRole('listitem');

async function fillPanel(user: ReturnType<typeof userEvent.setup>, v: { name: string; dob: string; pony?: string; height?: string }) {
  await user.type(screen.getByLabelText('Rider'), v.name);
  await user.type(screen.getByLabelText('Date of birth'), v.dob);
  if (v.pony !== undefined) await user.type(screen.getByLabelText('Pony'), v.pony);
  if (v.height !== undefined) await user.type(screen.getByLabelText('Height (hh)'), v.height);
}

beforeEach(() => {
  state.user = { id: 'u1', fullName: 'Alex Morgan', email: 'alex@example.com', clubId: 1, clubName: 'Stockport PC', roles: ['Trainer'] };
  forms = [];
  savedRiders = saved;
  state.get.mockImplementation(async (url: string) => {
    if (url === '/declaration-forms') return { data: forms };
    if (url === '/clubs/1/saved-riders') return { data: savedRiders };
    throw new Error(`unexpected ${url}`);
  });
  state.post.mockImplementation(async (_url: string, body: { teamId: number; riders: unknown[] }) => ({
    data: { id: 50, teamId: body.teamId, teamName: 'Stockport C', competitionId: 4, competitionName: 'Cheshire Area MG', submittedAt: '2026-10-22T10:00:00Z', isLocked: true, riders: [] },
  }));
  state.del.mockResolvedValue({});
});

describe('DeclarationsTab: the dec form', () => {
  it('opens a lone team at once, with the design\'s fields, five rider slots and a reserve slot', async () => {
    mount();
    await opened();
    expect(await screen.findByRole('heading', { name: 'Stockport C' })).toBeInTheDocument();
    expect(screen.getByText('U10 · Cheshire Area MG · Sat 24 Oct')).toBeInTheDocument();
    for (const label of ['Team name', 'Bibs', 'Trainer name', 'Phone number', /Notes for the organisers/]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText('Trainer name')).toHaveValue('Alex Morgan');
    expect(slotButtons()).toHaveLength(6);
    expect(within(slotButtons()[5]).getByText('Non-riding reserve (optional)')).toBeInTheDocument();
    expect(screen.getByText('0 of 5 riders added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit dec form' })).toBeDisabled();
    expect(screen.queryByText(/Dec form due by/)).not.toBeInTheDocument();
    // No rider numbers, order controls or captain, and no helper copy.
    expect(screen.queryByTitle('Captain')).not.toBeInTheDocument();
    expect(screen.queryByText(/captain/i)).not.toBeInTheDocument();
  });

  it('fills a slot from the panel, then opens the next empty slot', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(within(slotButtons()[0]).getByRole('button'));
    const panel = screen.getByRole('region', { name: 'Add a rider' });
    expect(within(panel).getByRole('button', { name: 'Add rider' })).toBeDisabled();
    await fillPanel(user, { name: 'Ella Hughes', dob: '05/04/2015', pony: 'Pickle', height: '13.2' });
    await user.click(within(panel).getByRole('button', { name: 'Add rider' }));
    expect(within(slotButtons()[0]).getByText('Ella Hughes')).toBeInTheDocument();
    expect(within(slotButtons()[0]).getByText('Pickle · 13.2 hh · born 05/04/2015')).toBeInTheDocument();
    expect(screen.getByText('1 of 5 riders added')).toBeInTheDocument();
    expect(screen.getByLabelText('Rider')).toHaveValue('');
    expect(within(slotButtons()[1]).getByText('Adding')).toBeInTheDocument();
  });

  it('keeps Add rider off until the date and the height are real', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(within(slotButtons()[0]).getByRole('button'));
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
    await user.click(within(slotButtons()[0]).getByRole('button'));
    await user.click(screen.getByRole('button', { name: 'Ella Hughes — Pickle' }));
    expect(screen.getByLabelText('Rider')).toHaveValue('Ella Hughes');
    expect(screen.getByLabelText('Date of birth')).toHaveValue('05/04/2015');
    expect(screen.getByLabelText('Pony')).toHaveValue('Pickle');
    expect(screen.getByLabelText('Height (hh)')).toHaveValue('13.2');
    await user.click(screen.getByRole('button', { name: 'Add rider' }));
    expect(screen.queryByRole('button', { name: 'Ella Hughes — Pickle' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Oliver Smith — Bramble' })).toBeInTheDocument();
  });

  it('asks the reserve only for a name and date of birth, and copies no pony across', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(within(slotButtons()[5]).getByRole('button'));
    const panel = screen.getByRole('region', { name: 'Add a non-riding reserve' });
    expect(within(panel).queryByLabelText('Pony')).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText('Height (hh)')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Ella Hughes — Pickle' }));
    expect(within(panel).getByRole('button', { name: 'Add reserve' })).toBeEnabled();
    await user.click(within(panel).getByRole('button', { name: 'Add reserve' }));
    expect(within(slotButtons()[5]).getByText('Reserve')).toBeInTheDocument();
    expect(within(slotButtons()[5]).getByText('Non-riding · born 05/04/2015')).toBeInTheDocument();
    expect(screen.getByText('0 of 5 riders added')).toBeInTheDocument();
  });

  it('edits a filled rider with Save, clears one with the cross, and closes the panel', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(within(slotButtons()[0]).getByRole('button'));
    await user.click(screen.getByRole('button', { name: 'Ella Hughes — Pickle' }));
    await user.click(screen.getByRole('button', { name: 'Add rider' }));
    await user.click(within(slotButtons()[0]).getAllByRole('button')[0]);
    const panel = screen.getByRole('region', { name: 'Edit rider' });
    expect(within(panel).queryByText('Pick a saved rider')).not.toBeInTheDocument();
    await user.clear(within(panel).getByLabelText('Pony'));
    await user.type(within(panel).getByLabelText('Pony'), 'Pickles');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(within(slotButtons()[0]).getByText('Pickles · 13.2 hh · born 05/04/2015')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Ella Hughes' }));
    expect(within(slotButtons()[0]).getByText('Adding')).toBeInTheDocument();
    await user.click(within(screen.getByRole('region', { name: 'Add a rider' })).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Add a rider' })).not.toBeInTheDocument();
  });

  it('closes the panel with Escape', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(within(slotButtons()[0]).getByRole('button'));
    await user.type(screen.getByLabelText('Rider'), '{Escape}');
    expect(screen.queryByRole('region', { name: 'Add a rider' })).not.toBeInTheDocument();
  });

  async function fillTeam(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(slotButtons()[0]).getByRole('button'));
    for (const name of ['Ella Hughes — Pickle', 'Oliver Smith — Bramble', 'Maisie Clarke — Toffee', 'Harry Wood — Jasper']) {
      await user.click(screen.getByRole('button', { name }));
      await user.click(screen.getByRole('button', { name: 'Add rider' }));
    }
    await fillPanel(user, { name: 'Sam New', dob: '01/02/2016', pony: 'Mist', height: '12.0' });
    await user.click(screen.getByRole('button', { name: 'Add rider' }));
  }

  it('submits only when all five riders are in and the terms are ticked, sending the new fields', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    const submit = screen.getByRole('button', { name: 'Submit dec form' });
    await fillTeam(user);
    // The reserve slot opens after the fifth rider; leaving it empty is fine.
    expect(within(slotButtons()[5]).getByText('Adding')).toBeInTheDocument();
    await user.click(within(screen.getByRole('region', { name: 'Add a non-riding reserve' })).getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Tick to agree, then submit')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Team complete' })).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Bibs'), 'Yellow with navy stars');
    await user.type(screen.getByLabelText('Phone number'), '07700 900123');
    await user.click(screen.getByRole('checkbox', { name: /I agree to the terms and conditions/ }));
    expect(screen.getByText('Ready to submit')).toBeInTheDocument();
    expect(submit).toBeEnabled();
    await user.click(submit);

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
    expect(await screen.findByText('Dec form submitted. You can still change it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submitted' })).toBeDisabled();
    expect(screen.getAllByText('Submitted')).toHaveLength(2);
  });

  it('lets the form be sent again after a change', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await fillTeam(user);
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.click(screen.getByRole('button', { name: 'Submit dec form' }));
    await screen.findByText('Dec form submitted. You can still change it.');
    await user.type(screen.getByLabelText(/Notes for the organisers/), 'Late arrival');
    expect(screen.queryByText('Dec form submitted. You can still change it.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit dec form' })).toBeEnabled();
  });

  it('shows the API\'s reason when the form is refused, and keeps the work', async () => {
    state.post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'A saved rider is not available to this account.' } } });
    const user = userEvent.setup();
    mount();
    await opened();
    await fillTeam(user);
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.click(screen.getByRole('button', { name: 'Submit dec form' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A saved rider is not available to this account.');
    expect(screen.getByRole('button', { name: 'Submit dec form' })).toBeEnabled();
    expect(within(slotButtons()[0]).getByText('Ella Hughes')).toBeInTheDocument();
  });

  it('falls back to a plain message when there was no signal', async () => {
    state.post.mockRejectedValueOnce(new Error('Network Error'));
    const user = userEvent.setup();
    mount();
    await opened();
    await fillTeam(user);
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.click(screen.getByRole('button', { name: 'Submit dec form' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the dec form. Check your signal and try again.');
  });

  it('shows the organiser\'s own terms behind the link, and a labelled placeholder when there are none', async () => {
    const user = userEvent.setup();
    const { unmount } = mount();
    await opened();
    await user.click(screen.getByRole('button', { name: 'terms and conditions' }));
    const dialog = screen.getByRole('dialog', { name: 'Terms and conditions' });
    expect(dialog).toHaveTextContent('Hats must be worn.');
    expect(dialog).toHaveTextContent('No bare feet.');
    expect(screen.getByRole('checkbox', { name: /I agree/ })).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    mount({ termsText: '   ' });
    await opened();
    await user.click(await screen.findByRole('button', { name: 'terms and conditions' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/Placeholder\./);
  });

  it('opens an existing declaration for editing, with the saved details and the submitted banner', async () => {
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
    expect(await screen.findByText('Dec form submitted. You can still change it.')).toBeInTheDocument();
    expect(screen.getByLabelText('Team name')).toHaveValue('Stockport C');
    expect(screen.getByLabelText('Bibs')).toHaveValue('Blue bibs');
    expect(screen.getByLabelText('Trainer name')).toHaveValue('Jo Hughes');
    expect(screen.getByLabelText('Phone number')).toHaveValue('07700 900123');
    expect(screen.getByLabelText(/Notes for the organisers/)).toHaveValue('Early start please');
    expect(within(slotButtons()[0]).getByText('Pickle · 13.2 hh · born 05/04/2015')).toBeInTheDocument();
    expect(within(slotButtons()[5]).getByText('Non-riding · born 02/01/2016')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submitted' })).toBeDisabled();
  });

  it('keeps the captain flag and privacy choices of a rider it does not show', async () => {
    forms = [{
      id: 9, teamId: 7, teamName: 'Stockport C', competitionId: 4, competitionName: 'Cheshire Area MG', submittedAt: '2026-10-20T09:00:00Z', isLocked: true,
      riders: [0, 1, 2, 3, 4].map((i) => ({
        id: i + 1, fullName: `Rider ${i + 1}`, dateOfBirth: '2015-04-05T00:00:00', horseName: 'Pony', ponyHeightHands: 13, isCaptain: i === 0, isReserve: false, orderIndex: i,
        noFilming: i === 1, useInitialOnly: i === 2,
      })),
    }];
    const user = userEvent.setup();
    mount();
    await opened();
    await screen.findByText('Dec form submitted. You can still change it.');
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.type(screen.getByLabelText(/Notes for the organisers/), 'x');
    await user.click(screen.getByRole('button', { name: 'Submit dec form' }));
    await waitFor(() => expect(state.post).toHaveBeenCalled());
    const riders = state.post.mock.calls[0][1].riders;
    expect(riders[0].isCaptain).toBe(true);
    expect(riders[1].noFilming).toBe(true);
    expect(riders[2].useInitialOnly).toBe(true);
  });

  it('needs only two riders for a pair and one for an individual, with no reserve slot', async () => {
    mount({ teams: [team(8, { competitionId: 4, competitionSectionId: 6, clubId: 1, displayName: 'Pair A', trainerUserId: 'u1' })] });
    expect(await screen.findByText('0 of 2 riders added')).toBeInTheDocument();
    expect(slotButtons()).toHaveLength(2);
  });

  it('allows a four-rider team to submit without a fifth rider', async () => {
    const user = userEvent.setup();
    mount();
    await opened();
    await user.click(within(slotButtons()[0]).getByRole('button'));
    for (const name of ['Ella Hughes — Pickle', 'Oliver Smith — Bramble', 'Maisie Clarke — Toffee', 'Harry Wood — Jasper']) {
      await user.click(screen.getByRole('button', { name }));
      await user.click(screen.getByRole('button', { name: 'Add rider' }));
    }
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    const submit = screen.getByRole('button', { name: 'Submit dec form' });
    expect(submit).toBeEnabled();
    await user.click(submit);
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
    await user.click(within(slotButtons()[0]).getByRole('button'));
    expect(screen.getByRole('button', { name: 'Ella Hughes — Pickle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ella Hughes — Flash' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ella Hughes — Flash' }));
    expect(screen.getByLabelText('Rider')).toHaveValue('Ella Hughes');
    expect(screen.getByLabelText('Pony')).toHaveValue('Flash');
    expect(screen.getByLabelText('Height (hh)')).toHaveValue('14.0');
  });

  it('lets organisers set and clear the deadline, and reports failed saves', async () => {
    state.user!.roles = ['Admin'];
    const user = userEvent.setup();
    const lockUrl = '/declaration-forms/competition/4/lock-time';
    state.put.mockResolvedValueOnce({ data: { competitionId: 4, declarationsCloseAt: '2040-01-02T12:00:00Z', isClosed: false } });
    mount();
    await opened();
    fireEvent.change(screen.getByLabelText('Declaration deadline'), { target: { value: '2040-01-02T12:00' } });
    await user.click(screen.getByRole('button', { name: 'Set lock time' }));
    expect(state.put).toHaveBeenCalledWith(lockUrl, { declarationsCloseAt: new Date('2040-01-02T12:00').toISOString() });
    state.put.mockRejectedValueOnce(new Error('offline'));
    await user.click(await screen.findByRole('button', { name: 'Clear lock time' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The deadline could not be saved');
    state.put.mockResolvedValueOnce({ data: { competitionId: 4, declarationsCloseAt: null, isClosed: false } });
    await user.click(screen.getByRole('button', { name: 'Clear lock time' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear lock time' })).not.toBeInTheDocument());
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
    expect(await screen.findByText(/Declarations are locked for this competition/)).toBeInTheDocument();
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
    expect(localStorage.getItem(decDraftKey(4, 7))).toBeNull();
  });

  it('keeps work in progress on the device, and brings it back with the same team open', async () => {
    const user = userEvent.setup();
    const first = mount();
    await user.type(await screen.findByLabelText('Bibs'), 'Green stripes');
    await user.click(within(slotButtons()[0]).getByRole('button'));
    await user.click(screen.getByRole('button', { name: 'Ella Hughes — Pickle' }));
    await user.click(screen.getByRole('button', { name: 'Add rider' }));
    expect(JSON.parse(localStorage.getItem(decDraftKey(4, 7))!)).toMatchObject({ teamId: 7, bibs: 'Green stripes' });
    first.unmount();

    mount();
    expect(await screen.findByDisplayValue('Green stripes')).toBeInTheDocument();
    expect(within(slotButtons()[0]).getByText('Ella Hughes')).toBeInTheDocument();
    expect(screen.queryByText('Dec form submitted. You can still change it.')).not.toBeInTheDocument();
  });

  it('forgets the draft once the form has gone in', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText('Bibs'), 'Green');
    expect(localStorage.getItem(decDraftKey(4, 7))).not.toBeNull();
    await user.click(within(slotButtons()[0]).getByRole('button'));
    for (const name of ['Ella Hughes — Pickle', 'Oliver Smith — Bramble', 'Maisie Clarke — Toffee', 'Harry Wood — Jasper', 'Ruby Ash — Domino']) {
      await user.click(screen.getByRole('button', { name }));
      await user.click(screen.getByRole('button', { name: 'Add rider' }));
    }
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.click(screen.getByRole('button', { name: 'Submit dec form' }));
    await screen.findByText('Dec form submitted. You can still change it.');
    expect(localStorage.getItem(decDraftKey(4, 7))).toBeNull();
  });

  it('ignores a draft that does not fit the team', async () => {
    localStorage.setItem(decDraftKey(4, 7), JSON.stringify({ teamId: 7, slots: [null, null] }));
    mount();
    expect(await screen.findByText('0 of 5 riders added')).toBeInTheDocument();
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
  it('asks a visitor to sign in', async () => {
    state.user = null;
    mount();
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument();
  });

  it('says so when the person has no team here', async () => {
    mount({ teams: [] });
    expect(await screen.findByText('You have no teams in this competition.')).toBeInTheDocument();
  });

  it('lists the forms already sent, without a captain star, with height and trainer', async () => {
    forms = [{
      id: 9, teamId: 70, teamName: 'Other Club A', competitionId: 4, competitionName: 'Cheshire Area MG', submittedByName: 'Pat Lee', trainerName: 'Jo Hughes',
      submittedByPhone: '0777', submittedAt: '2026-10-20T09:00:00Z', isLocked: true, bibDescription: 'Red bibs', notes: 'Hello',
      riders: [
        { id: 1, fullName: 'Ella Hughes', horseName: 'Pickle', ponyHeightHands: 13.2, isCaptain: true, isReserve: false, isGuestRider: true, orderIndex: 0 },
        { id: 2, fullName: 'Rita Reserve', isCaptain: false, isReserve: true, orderIndex: 1 },
      ],
    }];
    mount();
    const card = (await screen.findByRole('heading', { name: 'Other Club A' })).closest('div.card') as HTMLElement;
    expect(within(card).getByText('Jo Hughes')).toBeInTheDocument();
    expect(within(card).getByText('Pickle · 13.2 hh')).toBeInTheDocument();
    expect(within(card).getByText('Guest')).toBeInTheDocument();
    expect(within(card).getByLabelText('Reserve')).toBeInTheDocument();
    expect(within(card).getByText('Bibs: Red bibs')).toBeInTheDocument();
    expect(card.querySelector('.fill-amber-500')).toBeNull();
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
    expect(await screen.findByRole('heading', { name: 'Other Club A' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete the dec form for Other Club A' })).not.toBeInTheDocument();
    const asked = autoConfirm([false, true]);
    await user.click(await screen.findByRole('button', { name: 'Delete the dec form for Stockport C' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Delete the dec form for Stockport C? This can’t be undone.'));
    expect(state.del).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete the dec form for Stockport C' }));
    await waitFor(() => expect(state.del).toHaveBeenCalledWith('/declaration-forms/9'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete the dec form for Stockport C' })).not.toBeInTheDocument());
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
    await user.click(within(slotButtons()[0]).getByRole('button'));
    expect(screen.queryByText('Pick a saved rider')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rider')).toBeInTheDocument();
  });
});
