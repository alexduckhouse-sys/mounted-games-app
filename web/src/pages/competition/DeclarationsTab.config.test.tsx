import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeclarationForm, Role } from '../../types';
import { competition, team } from '../../test/factories';
import { BASIC_CONFIG, type DecFormConfig } from '../../lib/decFormConfig';
import { CompetitionContext } from './context';
import { DeclarationsTab } from './DeclarationsTab';

const state = vi.hoisted(() => ({
  user: { id: 'u1', fullName: 'Alex Morgan', email: 'a@example.com', clubId: 1, clubName: 'Stockport PC', roles: ['Trainer'] } as { id: string; fullName: string; email: string; clubId: number | null; clubName: string; roles: Role[] },
  get: vi.fn(),
  post: vi.fn(),
  download: vi.fn(),
  organise: false,
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: state.user, hasRole: (r: Role) => state.user.roles.includes(r), canOrganise: () => state.organise }),
}));
vi.mock('../../api', () => ({ api: { get: state.get, post: state.post, delete: vi.fn() } }));
vi.mock('../../lib/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/csv')>()), downloadCsv: state.download }));

const setup: DecFormConfig = {
  ...BASIC_CONFIG,
  weight: 2, weightUnit: 0, medicalNotes: 1, ponyPassport: 2,
  customFields: [{ id: 'girth', label: 'Girth', type: 1, required: false, min: 20, max: 90, unit: 'cm' }],
};

let forms: DeclarationForm[];
let config: DecFormConfig | Error;

function mount() {
  const value = {
    competition: competition({
      id: 4, name: 'Cheshire Area MG', startDate: '2026-10-24',
      sections: [{ id: 5, competitionId: 4, format: 3, ageGroup: 'U10', displayName: 'U10' }],
      teams: [team(7, { competitionId: 4, competitionSectionId: 5, clubId: 1, displayName: 'Stockport C', trainerUserId: 'u1' })],
    }),
    reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [],
  };
  return render(<MemoryRouter initialEntries={['/competitions/4/declarations']}>
    <CompetitionContext.Provider value={value}><DeclarationsTab /></CompetitionContext.Provider>
  </MemoryRouter>);
}

beforeEach(() => {
  state.user = { id: 'u1', fullName: 'Alex Morgan', email: 'a@example.com', clubId: 1, clubName: 'Stockport PC', roles: ['Trainer'] };
  forms = [];
  state.organise = false;
  config = setup;
  state.get.mockImplementation(async (url: string) => {
    if (url === '/declaration-forms') return { data: forms };
    if (url === '/clubs/1/saved-riders') return { data: [] };
    if (url === '/competitions/4/dec-form-config') {
      if (config instanceof Error) throw config;
      return { data: { config, isStandard: false, formsSubmitted: forms.length } };
    }
    throw new Error(`unexpected ${url}`);
  });
  state.post.mockImplementation(async (_url: string, body: { teamId: number }) => ({
    data: { id: 50, teamId: body.teamId, teamName: 'Stockport C', competitionId: 4, competitionName: 'Cheshire Area MG', submittedAt: '2026-10-22T10:00:00Z', isLocked: true, riders: [] },
  }));
});

describe('DeclarationsTab with a set-up dec form', () => {
  it('asks only what the organiser asked for, and holds Add back until the required answers are in', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Team name');
    await user.click(within(screen.getByRole('list', { name: 'Riders' })).getAllByRole('listitem')[0].querySelector('button')!);
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Height (hh)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rider’s weight')).toBeInTheDocument();
    expect(screen.getByLabelText('Pony passport or ID number')).toBeInTheDocument();
    expect(screen.getByLabelText(/Medical notes/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Girth/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Rider'), 'Ella Hughes');
    await user.type(screen.getByLabelText('Pony'), 'Pickle');
    expect(screen.getByRole('button', { name: 'Add rider' })).toBeDisabled();
    expect(screen.getByText('Still needed: weight, pony passport or ID number.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Rider’s weight'), '31.5');
    await user.type(screen.getByLabelText('Pony passport or ID number'), 'GB123');
    expect(screen.getByRole('button', { name: 'Add rider' })).toBeEnabled();
  });

  it('warns in amber while a number is over the limit, still lets it through, and sends it', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Team name');
    await user.click(within(screen.getByRole('list', { name: 'Riders' })).getAllByRole('listitem')[0].querySelector('button')!);
    await user.type(screen.getByLabelText('Rider'), 'Ella Hughes');
    await user.type(screen.getByLabelText('Pony'), 'Pickle');
    await user.type(screen.getByLabelText('Rider’s weight'), '31.5');
    await user.type(screen.getByLabelText('Pony passport or ID number'), 'GB123');

    expect(screen.getByText('Expected 20 to 90 cm')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Girth/), '95');
    expect(screen.getByRole('status')).toHaveTextContent('Above the limit — will be flagged');
    expect(screen.getByRole('button', { name: 'Add rider' })).toBeEnabled();
    await user.clear(screen.getByLabelText(/Girth/));
    await user.type(screen.getByLabelText(/Girth/), '10');
    expect(screen.getByRole('status')).toHaveTextContent('Below the minimum — will be flagged');
    await user.clear(screen.getByLabelText(/Girth/));
    await user.type(screen.getByLabelText(/Girth/), '95');

    await user.click(screen.getByRole('button', { name: 'Add rider' }));
    const slot = within(screen.getByRole('list', { name: 'Riders' })).getAllByRole('listitem')[0];
    expect(within(slot).getByText('Pickle')).toBeInTheDocument();
    expect(within(slot).getByText(/This will be flagged for the organisers/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Submit dec form' })).toBeDisabled();
    await user.type(screen.getByLabelText('Phone number'), '12345');
    expect(screen.getByText('Enter a UK or Irish number, like 07123 456789.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit dec form' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Phone number'));
    await user.type(screen.getByLabelText('Phone number'), '+44 7123 456789');
    await user.click(screen.getByRole('button', { name: 'Submit dec form' }));
    await waitFor(() => expect(state.post).toHaveBeenCalled());
    expect(state.post.mock.calls[0][1]).toMatchObject({ trainerPhone: '+44 7123 456789', bibDescription: '' });
    expect(screen.queryByLabelText('Bibs')).not.toBeInTheDocument();
    expect(state.post.mock.calls[0][1].riders[0]).toMatchObject({
      fullName: 'Ella Hughes', weightKg: 31.5, ponyPassportNumber: 'GB123', customValues: { girth: '95' }, dateOfBirth: null, ponyHeightHands: null,
    });
  });

  it('falls back to the standard form when the setup can’t be fetched', async () => {
    const user = userEvent.setup();
    config = new Error('offline');
    mount();
    await screen.findByLabelText('Team name');
    await user.click(within(screen.getByRole('list', { name: 'Riders' })).getAllByRole('listitem')[0].querySelector('button')!);
    expect(screen.getByLabelText('Date of birth')).toBeInTheDocument();
    expect(screen.getByLabelText('Height (hh)')).toBeInTheDocument();
  });
});

describe('the dec form list for organisers', () => {
  const submitted = (extra: Partial<DeclarationForm> = {}): DeclarationForm => ({
    id: 1, teamId: 7, teamName: 'Stockport C', competitionId: 4, competitionName: 'Cheshire Area MG', submittedAt: '2026-10-20T09:00:00Z', isLocked: true,
    trainerName: 'Alex Morgan',
    riders: [{
      id: 1, fullName: 'Ella Hughes', horseName: 'Pickle', isCaptain: false, isReserve: false, orderIndex: 0,
      weightKg: 31.5, medicalNotes: 'Asthma', customValues: { girth: '95' }, flags: ['Ella Hughes: Girth is 95 cm, over the limit of 90 cm.'],
    }],
    flagCount: 1, entryTeamName: 'Welsh Dragons',
    ...extra,
  });

  const openForm = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole('button', { name: /^Stockport C.*Sent/ }));

  it('shows the flag, the flagged sentence, the extra answers and the name given at entry', async () => {
    forms = [submitted()];
    mount();
    expect(await screen.findByText('1 flagged')).toBeInTheDocument();
    await openForm(userEvent.setup());
    expect(screen.getByText('Ella Hughes: Girth is 95 cm, over the limit of 90 cm.')).toBeInTheDocument();
    expect(screen.getByText(/31.5 kg · medical: Asthma · Girth: 95 cm/)).toBeInTheDocument();
    expect(screen.getByText('Entered as Welsh Dragons')).toBeInTheDocument();
    // The editor above also says so.
    expect(await screen.findByText('Entered as “Welsh Dragons”.')).toBeInTheDocument();
  });

  it('shows nothing extra on a form with no flags, and nothing private on a public one', async () => {
    forms = [submitted({
      flagCount: 0, entryTeamName: 'Stockport C',
      riders: [{ id: 1, fullName: 'Ella H.', horseName: 'Pickle', isCaptain: false, isReserve: false, orderIndex: 0 }],
    })];
    mount();
    await openForm(userEvent.setup());
    await screen.findAllByText('Ella H.');
    expect(screen.queryByText(/flagged/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Entered as/)).not.toBeInTheDocument();
    expect(screen.queryByText(/medical/)).not.toBeInTheDocument();
  });

  it('adds the extra answers to the CSV only when there are some', async () => {
    const user = userEvent.setup();
    state.organise = true;
    forms = [submitted()];
    mount();
    await screen.findByText('1 flagged');
    await user.click(screen.getByRole('button', { name: /Export CSV/ }));
    const [, csv] = state.download.mock.calls[0];
    const [header, row] = (csv as string).split('\n');
    expect(header).toContain('Weight (kg),Medical notes,Girth,Flags');
    expect(header).not.toContain('Membership number');
    expect(row).toContain('31.5');
    expect(row).toContain('over the limit of 90 cm');
  });

  it('keeps the CSV as it was when no one gave an extra answer', async () => {
    const user = userEvent.setup();
    state.organise = true;
    forms = [submitted({ flagCount: 0, riders: [{ id: 1, fullName: 'Ella H.', horseName: 'Pickle', isCaptain: false, isReserve: false, orderIndex: 0 }] })];
    mount();
    await user.click(await screen.findByRole('button', { name: /Export CSV/ }));
    const [, csv] = state.download.mock.calls[0];
    expect((csv as string).split(/\r?\n/)[0]).toBe('Team,Rider,Reserve,Guest,DOB,Pony,Height (hh),Bibs,Trainer,Phone,Submitted by,Terms agreed,Submitted at,Notes');
  });
});
