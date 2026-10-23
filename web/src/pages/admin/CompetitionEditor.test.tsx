import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import { defaultDraft, defaultSection, type CreatorDraft, type STEP_IDS } from '../../lib/creatorDraft';
import { resetRaceTemplates } from '../../lib/raceTemplates';
import { competition, heat, race, session, team } from '../../test/factories';
import { CompetitionEditor } from './CompetitionEditor';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

function signIn(roles: string[], id = 'u1') {
  const auth: StoredAuth = {
    token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id, email: 'a@example.com', fullName: 'Alex', clubId: null, clubName: null, roles },
  };
  localStorage.setItem('mg.auth', JSON.stringify(auth));
}

function mount(path = '/admin/competitions/new') {
  return render(
    <AuthProvider><MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/admin/competitions/new" element={<CompetitionEditor />} />
      <Route path="/admin/competitions/:id" element={<CompetitionEditor />} />
      <Route path="/competitions/:id" element={<p>Competition page</p>} />
    </Routes></MemoryRouter></AuthProvider>,
  );
}

const draftKey = 'competitionEditor:new';
const stored = (key = draftKey) => JSON.parse(localStorage.getItem(key) ?? 'null');
const nextButton = () => screen.getByText('Next', { selector: 'button' });
const createButton = () => screen.getByText('Create competition', { selector: 'button' });
const next = () => userEvent.click(nextButton());
const step = (name: string) => screen.getByLabelText(new RegExp(`^${name}`));
const STEPS: readonly (typeof STEP_IDS)[number][] = ['about', 'when', 'sections', 'structure', 'races', 'dec', 'payment', 'review'];

/** Puts a draft in storage so a test can start at any step with sensible values. */
function seed(step: (typeof STEPS)[number], extra: Partial<CreatorDraft> = {}, key = draftKey) {
  const draft: CreatorDraft = { ...defaultDraft(new Date(2026, 9, 24)), name: 'Spring Games', startDate: '2026-10-24', ...extra, step: STEPS.indexOf(step) };
  localStorage.setItem(key, JSON.stringify(draft));
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  resetRaceTemplates();
  signIn(['Admin']);
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/auth/me') return { data: {} };
    if (url === '/competitions/access') return { data: [] };
    if (url === '/race-templates') return { data: [{ id: 1, name: '2 Flag' }, { id: 2, name: 'Speed Weave' }] };
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.post).mockImplementation(async (url) => ({ data: url === '/competitions' ? { id: 41 } : url.endsWith('/sections') ? { id: 51 } : {} }));
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  vi.mocked(api.delete).mockResolvedValue({ data: {} });
});

describe('CompetitionEditor: the steps', () => {
  it('opens on the first step with a step indicator, no Back, and the steps listed', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'New competition' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'About the competition' })).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 8/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    const steps = within(screen.getByRole('navigation', { name: 'Steps' })).getAllByRole('button');
    expect(steps.map((b) => b.getAttribute('aria-label'))).toEqual(['About', 'When & where', 'Sections', 'Structure & timing', 'Races', 'Dec form', 'Payment & notes', 'Review']);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toBeDisabled();
    for (const label of ['Name', 'Icon', 'Organiser']) expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('moves forward and back through the steps', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring Games');
    await next();
    expect(screen.getByRole('heading', { level: 2, name: 'When and where' })).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 8/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Back', { selector: 'button' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Spring Games');
    // A step already reached can be opened from the list.
    await next();
    await next();
    expect(screen.getByRole('heading', { level: 2, name: 'What people can enter' })).toBeInTheDocument();
    await userEvent.click(step('About'));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    await userEvent.click(step('Sections'));
    expect(screen.getByRole('heading', { level: 2, name: 'What people can enter' })).toBeInTheDocument();
    expect(step('Races')).toBeDisabled();
  });

  it('walks to the review step, where Next turns into Create', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring Games');
    for (let i = 0; i < 7; i += 1) await next();
    expect(screen.getByRole('heading', { level: 2, name: 'Review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(createButton()).toBeInTheDocument();
  });
});

describe('CompetitionEditor: validation one step at a time', () => {
  it('needs a name before leaving the first step, takes focus to it and clears the message when fixed', async () => {
    mount();
    await next();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByLabelText('Name').parentElement).toHaveAttribute('data-invalid', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'About the competition' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'S');
    expect(screen.getByLabelText('Name')).not.toHaveAccessibleDescription('Enter a name.');
    await next();
    expect(screen.getByRole('heading', { level: 2, name: 'When and where' })).toBeInTheDocument();
  });

  it('needs a start date and time, and an end that is not before the start', async () => {
    seed('when');
    mount();
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '' } });
    await next();
    expect(screen.getByLabelText('Starts')).toHaveAccessibleDescription('Choose a start date.');
    expect(screen.getByLabelText('Start time')).toHaveAccessibleDescription('Choose a start time.');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-24' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-23' } });
    await next();
    expect(screen.getByLabelText('Ends')).toHaveAccessibleDescription('The end can’t be before the start.');
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-25' } });
    await next();
    expect(screen.getByRole('heading', { level: 2, name: 'What people can enter' })).toBeInTheDocument();
  });

  it('stops on the structure step for minutes that make no sense', async () => {
    seed('structure');
    mount();
    const group = screen.getByRole('group', { name: 'Structure for Senior Teams' });
    await userEvent.clear(within(group).getByLabelText(/Minutes per race/));
    await userEvent.type(within(group).getByLabelText(/Minutes per race/), '0');
    await userEvent.clear(within(group).getByLabelText('Teams through to the final'));
    await userEvent.type(within(group).getByLabelText('Teams through to the final'), '99');
    await next();
    expect(within(group).getByLabelText(/Minutes per race/)).toHaveAccessibleDescription('Minutes per race must be from 1 to 180.');
    expect(within(group).getByLabelText('Teams through to the final')).toHaveAccessibleDescription('Teams in the final must be from 1 to 50.');
    expect(screen.getByRole('heading', { level: 2, name: 'Structure and timing' })).toBeInTheDocument();
  });
});

describe('CompetitionEditor: sections', () => {
  it('starts with one Senior Teams section and adds and removes rows', async () => {
    seed('sections');
    mount();
    const row = screen.getByRole('group', { name: 'Section 1' });
    expect(within(row).getByLabelText('Format')).toHaveValue('2');
    expect(within(row).getByLabelText('Age group')).toHaveValue('Seniors');
    expect(within(row).getByLabelText('Price')).toHaveValue('');
    expect(within(row).getByLabelText('Max entries')).toHaveAttribute('placeholder', 'No cap');
    expect(within(row).getByRole('button', { name: 'Remove section 1' })).toBeDisabled();
    await userEvent.click(screen.getByText('Add a section', { selector: 'button' }));
    expect(within(screen.getByRole('group', { name: 'Section 2' })).getByLabelText('Age group')).toHaveValue('Under 10');
    await userEvent.click(screen.getByLabelText('Remove section 1'));
    expect(screen.queryByRole('group', { name: 'Section 2' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Section 1' })).getByLabelText('Age group')).toHaveValue('Under 10');
  });

  it('lets you type your own age group, and names the section after it', async () => {
    seed('sections');
    mount();
    const row = screen.getByRole('group', { name: 'Section 1' });
    await userEvent.selectOptions(within(row).getByLabelText('Format'), '3');
    await userEvent.selectOptions(within(row).getByLabelText('Age group'), 'Type your own…');
    const own = within(row).getByLabelText('Your age group');
    expect(own).toHaveValue('');
    await next();
    expect(own).toHaveAccessibleDescription('Enter an age group.');
    await userEvent.type(own, 'Veterans');
    expect(within(row).getByText('Veteran Individuals')).toBeInTheDocument();
    await next();
    expect(screen.getByRole('heading', { level: 2, name: 'Structure and timing' })).toBeInTheDocument();
    expect(stored().sections[0]).toMatchObject({ format: 3, ageGroup: 'Veterans' });
    // Going back keeps the typed age group in the box.
    await userEvent.click(step('Sections'));
    expect(screen.getByLabelText('Your age group')).toHaveValue('Veterans');
    await userEvent.selectOptions(screen.getByLabelText('Age group'), 'Juniors');
    expect(screen.queryByLabelText('Your age group')).not.toBeInTheDocument();
    expect(screen.getByText('Junior Individuals')).toBeInTheDocument();
  });

  it('refuses the same age group twice in one format', async () => {
    seed('sections', { sections: [defaultSection(), defaultSection()] });
    mount();
    await next();
    expect(within(screen.getByRole('group', { name: 'Section 2' })).getByLabelText('Age group')).toHaveAccessibleDescription('You already have this age group in this format.');
  });

  it('takes digits only in price and max, with no e, plus or minus', async () => {
    seed('sections');
    mount();
    const row = screen.getByRole('group', { name: 'Section 1' });
    await userEvent.type(within(row).getByLabelText('Price'), '1e2+5-.5.');
    expect(within(row).getByLabelText('Price')).toHaveValue('125.5');
    await userEvent.type(within(row).getByLabelText('Max entries'), '2e4-');
    expect(within(row).getByLabelText('Max entries')).toHaveValue('24');
    await userEvent.type(within(row).getByLabelText('Price'), '55');
    expect(within(row).getByLabelText('Price')).toHaveValue('125.55');
  });
});

describe('CompetitionEditor: structure and timing', () => {
  it('shows the sessions, heat, heat, final and an estimate that follows the numbers', async () => {
    seed('structure', { sections: [{ ...defaultSection(), maxParticipants: '40', maxTeamsPerHeat: '4', minutesPerRace: '5' }] });
    mount();
    const group = screen.getByRole('group', { name: 'Structure for Senior Teams' });
    expect(group).toHaveTextContent('Estimate: about 10 teams, from the entry limit, 3 heats (4, 3, 3), about 2 h 30 min a session.');
    await userEvent.selectOptions(within(group).getByLabelText('Sessions'), '2');
    expect(stored().sections[0].sessions).toHaveLength(2);
    await userEvent.click(within(group).getByRole('radio', { name: 'Heat, heat, final (HHF)' }));
    expect(within(group).getByLabelText('Sessions')).toBeDisabled();
    expect(within(group).getByLabelText('Sessions')).toHaveValue('1');
    expect(group).toHaveTextContent('qualifier heats and a final for each race');
    expect(stored().sections[0]).toMatchObject({ usesRaceFinals: true });
    expect(stored().sections[0].sessions).toHaveLength(1);
  });

  it('picks the run-off race from the library and sets finalists, minutes, heat size and arena', async () => {
    seed('structure');
    mount();
    const group = screen.getByRole('group', { name: 'Structure for Senior Teams' });
    await waitFor(() => expect(within(group).getByRole('option', { name: 'Speed Weave' })).toBeInTheDocument());
    await userEvent.selectOptions(within(group).getByLabelText('Run-off race'), 'Speed Weave');
    await userEvent.type(within(group).getByLabelText('Teams through to the final'), '6');
    await userEvent.clear(within(group).getByLabelText('Arena'));
    await userEvent.type(within(group).getByLabelText('Arena'), 'Arena 2');
    expect(stored().sections[0]).toMatchObject({ runoffRaceName: 'Speed Weave', finalistCount: '6', arena: 'Arena 2' });
  });

  it('keeps a run-off race that is not in the library in the list', () => {
    seed('structure', { sections: [{ ...defaultSection(), runoffRaceName: 'Old Race' }] });
    mount();
    expect(screen.getByRole('option', { name: 'Old Race' })).toBeInTheDocument();
  });
});

describe('CompetitionEditor: hatbands', () => {
  it('lists a lane for the biggest heat with the default colours, and lets each be changed or typed', async () => {
    seed('structure', { sections: [{ ...defaultSection(), maxTeamsPerHeat: '4' }, { ...defaultSection(), ageGroup: 'Open', maxTeamsPerHeat: '5' }] });
    mount();
    const group = screen.getByRole('group', { name: 'Hatbands' });
    expect(within(group).getByLabelText('Lane 1')).toHaveValue('Red');
    expect(within(group).getByLabelText('Lane 2')).toHaveValue('White');
    expect(within(group).getByLabelText('Lane 5')).toHaveValue('Green');
    expect(within(group).queryByLabelText('Lane 6')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(group).getByLabelText('Lane 1'), 'Pink');
    await userEvent.selectOptions(within(group).getByLabelText('Lane 2'), 'Type your own…');
    await userEvent.type(within(group).getByLabelText('Hatband colour for lane 2'), 'Purple');
    expect(stored().laneHatbands).toEqual(['Pink', 'Purple', 'Blue', 'Yellow', 'Green']);
    await userEvent.selectOptions(within(group).getByLabelText('Lane 2'), 'Black');
    expect(stored().laneHatbands[1]).toBe('Black');
  });

  it('shows them on the review step and sends them when creating', async () => {
    seed('review', { laneHatbands: ['Pink'] });
    mount();
    expect(within(screen.getByRole('list', { name: 'Hatbands by lane' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Lane 1 · Pink', 'Lane 2 · White', 'Lane 3 · Blue', 'Lane 4 · Yellow', 'Lane 5 · Green', 'Lane 6 · Black']);
    await userEvent.click(createButton());
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions', expect.objectContaining({ laneHatbands: ['Pink', 'White', 'Blue', 'Yellow', 'Green', 'Black'] })));
  });
});

describe('CompetitionEditor: races', () => {
  it('can be skipped: sessions say they are left for later and nothing is required', async () => {
    seed('races');
    mount();
    const group = screen.getByRole('group', { name: 'Races for Senior Teams' });
    expect(group).toHaveTextContent('Left for later (planning for about 10 races)');
    await next();
    expect(screen.getByRole('heading', { level: 2, name: 'Dec form' })).toBeInTheDocument();
    expect(screen.getByText(/A new competition starts with the basics/)).toBeInTheDocument();
    await next();
    expect(screen.getByRole('heading', { level: 2, name: 'Payment and notes' })).toBeInTheDocument();
  });

  it('chooses a race list in a dialog and can put it back to later', async () => {
    seed('races');
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Choose races for Senior Teams' }));
    const dialog = await screen.findByRole('dialog', { name: 'Races for Senior Teams' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(10);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use Pony Club Area list' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save race list' }));
    const group = screen.getByRole('group', { name: 'Races for Senior Teams' });
    expect(group).toHaveTextContent('8 races: Bending, 5 Mug…');
    expect(stored().sections[0].sessions[0].races).toHaveLength(8);
    await userEvent.click(within(group).getByText('Leave for later', { selector: 'button' }));
    expect(group).toHaveTextContent('Left for later');
    await userEvent.click(within(group).getByText('Pony Club Zone list for all', { selector: 'button' }));
    expect(group).toHaveTextContent('10 races: Bending, Hollywood Bowl Boule & Bucket…');
  });

  it('names every session when an age group has several', () => {
    seed('races', { sections: [{ ...defaultSection(), sessions: [{ races: null }, { races: ['Bending'] }] }] });
    mount();
    expect(screen.getByText('Senior Teams · Session 1')).toBeInTheDocument();
    expect(screen.getByText('Senior Teams · Session 2')).toBeInTheDocument();
    expect(screen.getByText(/1 race: Bending/)).toBeInTheDocument();
  });
});

describe('CompetitionEditor: review and the provisional timetable', () => {
  it('shows the competition, the age groups and a timetable marked Provisional', () => {
    seed('review', { location: 'Tatton', sections: [{ ...defaultSection(), maxParticipants: '24', priceGbp: '12.5' }] });
    mount();
    expect(screen.getByText('Spring Games')).toBeInTheDocument();
    expect(screen.getByText(/Tatton/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Age groups' })).getByText(/£12.50 · max 24 entries · 1 session/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Timetable' }).parentElement).toHaveTextContent('Provisional');
    const rows = within(screen.getByRole('list', { name: 'Provisional timetable' })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Senior Teams');
    expect(rows[0]).toHaveTextContent('1 heat of 6, 10 races');
    expect(rows[0]).toHaveTextContent('1 h 40 min');
    expect(screen.getByText(/Races aren’t chosen for 1 session/)).toBeInTheDocument();
    expect(screen.getByText(/It becomes exact once teams are formed/)).toBeInTheDocument();
  });

  it('warns when the day runs past its end time', () => {
    seed('review', { sections: [{ ...defaultSection(), minutesPerRace: '60' }] });
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent('This runs until');
  });

  it('adds a break and a briefing, and the timetable works around them', async () => {
    seed('review', { startTime: '09:00' });
    mount();
    const form = screen.getByRole('group', { name: 'Add a break or briefing' });
    await userEvent.clear(within(form).getByLabelText('Name'));
    await userEvent.type(within(form).getByLabelText('Name'), 'Lunch');
    fireEvent.change(within(form).getByLabelText('Starts'), { target: { value: '09:00' } });
    await userEvent.clear(within(form).getByLabelText('Minutes'));
    await userEvent.type(within(form).getByLabelText('Minutes'), '45');
    await userEvent.click(within(form).getByText('Add to timetable', { selector: 'button' }));
    const rows = within(screen.getByRole('list', { name: 'Provisional timetable' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Lunch (break)');
    expect(rows[1]).toHaveTextContent('Senior Teams');
    expect(rows[1]).toHaveTextContent('09:45');
    expect(stored().breaks).toEqual([expect.objectContaining({ name: 'Lunch', minutes: '45', kind: 1 })]);
    await userEvent.click(screen.getByLabelText('Remove Lunch'));
    expect(stored().breaks).toEqual([]);
  });

  it('asks for a sensible length and start when adding a break', async () => {
    seed('review');
    mount();
    const form = screen.getByRole('group', { name: 'Add a break or briefing' });
    await userEvent.selectOptions(within(form).getByLabelText('Type'), 'Briefing');
    await userEvent.clear(within(form).getByLabelText('Minutes'));
    await userEvent.click(within(form).getByText('Add to timetable', { selector: 'button' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Enter how many minutes it lasts.');
    await userEvent.type(within(form).getByLabelText('Minutes'), '15');
    fireEvent.change(within(form).getByLabelText('Starts'), { target: { value: '' } });
    await userEvent.click(within(form).getByText('Add to timetable', { selector: 'button' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose when it starts.');
    fireEvent.change(within(form).getByLabelText('Starts'), { target: { value: '08:30' } });
    await userEvent.click(within(form).getByText('Add to timetable', { selector: 'button' }));
    expect(screen.getByText('Briefing (briefing)')).toBeInTheDocument();
  });
});

describe('CompetitionEditor: creating', () => {
  it('creates the competition, its age groups, sessions with estimated starts, and breaks, then opens it', async () => {
    seed('review', {
      organiserName: 'Cheshire PC', location: 'Tatton', description: 'Notes', paymentDestination: 'Bank', termsText: 'T',
      sections: [
        { ...defaultSection(), ageGroup: 'Juniors', format: 3, priceGbp: '12.5', maxParticipants: '16', finalistCount: '6', runoffRaceName: '2 Flag', minutesPerRace: '5', maxTeamsPerHeat: '4', sessions: [{ races: ['Bending', 'Bottle'] }, { races: null }] },
        { ...defaultSection(), ageGroup: 'Open', usesRaceFinals: true, arena: 'Arena 2' },
      ],
      breaks: [{ kind: 1, name: 'Lunch', date: '2026-10-24', time: '12:00', minutes: '30', arena: '' }],
    });
    mount();
    await userEvent.click(createButton());
    await waitFor(() => expect(screen.getByText('Competition page')).toBeInTheDocument());

    expect(api.post).toHaveBeenCalledWith('/competitions', expect.objectContaining({
      name: 'Spring Games', organiserName: 'Cheshire PC', location: 'Tatton', paymentDestination: 'Bank', termsText: 'T', description: 'Notes',
      startDate: new Date('2026-10-24T09:00').toISOString(), endDate: new Date('2026-10-24T17:00').toISOString(),
    }));
    expect(api.post).toHaveBeenCalledWith('/competitions/41/sections', {
      format: 3, ageGroup: 'Juniors', displayName: 'Junior Individuals', runoffRaceName: '2 Flag', usesRaceFinals: false, priceMinor: 1250, maxParticipants: 16, finalistCount: 6,
    });
    expect(api.post).toHaveBeenCalledWith('/competitions/41/sections', expect.objectContaining({ ageGroup: 'Open', displayName: 'Open Teams', usesRaceFinals: true }));
    const sessions = vi.mocked(api.post).mock.calls.filter(([url]) => url === '/competitions/41/sessions').map(([, body]) => body as Record<string, unknown>);
    expect(sessions.map((s) => s.name)).toEqual(['Junior Individuals · Session 1', 'Junior Individuals · Session 2', 'Open Teams', 'Lunch']);
    expect(sessions[0]).toMatchObject({
      competitionSectionId: 51, arenaName: 'Main arena', kind: 0, lanesPerHeat: 4, minutesPerHeat: 5, plannedRaces: ['Bending', 'Bottle'], scheduledStart: expect.any(String), durationMinutes: expect.any(Number),
    });
    expect(sessions[1].plannedRaces).toEqual([]);
    expect(sessions[2]).toMatchObject({ arenaName: 'Arena 2', minutesPerHeat: 10, lanesPerHeat: 6 });
    expect(sessions[3]).toMatchObject({ competitionSectionId: null, kind: 1, isBreak: true, durationMinutes: 30, arenaName: null });
    // Every session is ordered by when it starts; the first session of a busy arena starts at the event start.
    expect(new Date(sessions[0].scheduledStart as string).getTime()).toBe(new Date('2026-10-24T09:00').getTime());
    expect(stored()).toBeNull();
  });

  it('goes back to the step with the problem when something earlier is wrong', async () => {
    seed('review', { name: '  ' });
    mount();
    await userEvent.click(createButton());
    expect(screen.getByRole('heading', { level: 2, name: 'About the competition' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('checks the breaks on the review step before creating', async () => {
    seed('review', { breaks: [{ kind: 1, name: '', date: '2026-10-24', time: '12:00', minutes: '', arena: '' }] });
    mount();
    await userEvent.click(createButton());
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert', { name: '' })).toBeInTheDocument();
  });

  it('shows what went wrong, keeps the draft, and points to the competition if it was created', async () => {
    seed('review');
    vi.mocked(api.post).mockImplementation(async (url) => {
      if (url === '/competitions') return { data: { id: 41 } };
      throw { response: { data: { message: 'Section is not valid.' } } };
    });
    mount();
    await userEvent.click(createButton());
    const alert = await screen.findByText(/Adding Senior Teams failed: Section is not valid\./);
    expect(alert).toHaveTextContent('The competition was created.');
    expect(within(alert).getByRole('link', { name: 'Open it to finish' })).toHaveAttribute('href', '/admin/competitions/41');
    expect(stored()).not.toBeNull();
    expect(createButton()).toBeEnabled();
  });

  it('falls back to a plain message when the server says nothing useful', async () => {
    seed('review');
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    mount();
    await userEvent.click(createButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Creating competition failed: please try again');
  });

  it('is view only for someone who cannot organise', () => {
    localStorage.clear();
    signIn(['Member']);
    seed('review');
    mount();
    expect(screen.getByText('Only admins and trainers can save changes.')).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });
});

describe('CompetitionEditor: the draft', () => {
  it('shows nothing about a draft on a fresh page', () => {
    mount();
    expect(screen.queryByText(/Draft saved/)).not.toBeInTheDocument();
  });

  it('saves on every change, with the step, and shows the time it was saved', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring');
    expect(stored()).toMatchObject({ name: 'Spring', step: 0 });
    expect(await screen.findByText(/Draft saved \d\d:\d\d/)).toBeInTheDocument();
    await next();
    expect(stored().step).toBe(1);
  });

  it('comes back after a reload at the same step, with the steps already reached open', () => {
    seed('sections', { savedAt: '2026-10-24T10:15:00' });
    mount();
    expect(screen.getByRole('heading', { level: 2, name: 'What people can enter' })).toBeInTheDocument();
    expect(screen.getByText(/Draft saved 10:15/)).toBeInTheDocument();
    expect(step('When & where')).toBeEnabled();
    expect(step('Structure & timing')).toBeDisabled();
  });

  it('saves when Save draft is pressed, and can be discarded after asking', async () => {
    seed('about', { savedAt: '2026-10-24T10:15:00' });
    mount();
    await userEvent.click(screen.getByText('Save draft', { selector: 'button' }));
    expect(stored().savedAt).not.toBe('2026-10-24T10:15:00');
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(screen.getByText('Discard draft', { selector: 'button' }));
    expect(stored()).not.toBeNull();
    await userEvent.click(screen.getByText('Discard draft', { selector: 'button' }));
    expect(stored()).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it('upgrades a draft from the old one-page editor', () => {
    localStorage.setItem(draftKey, JSON.stringify({
      name: 'Old draft', startDate: '2026-10-24', startTime: '09:00', endDate: '', endTime: '17:00', location: '', icon: 'flag', step: 'review',
      what3Words: '', postcode: '', appleMapsUrl: '', lat: '', lon: '', description: '', teams: [],
      sections: [{ format: 2, ageGroup: 'Open', sessions: [{ name: 'x', races: 'A\nB', scope: 'Zone' }], minsPerHeat: 25, maxTeamsPerHeat: 6, runoffRaceName: '2 Flag', usesRaceFinals: false, priceGbp: '5' }],
    }));
    mount();
    expect(screen.getByLabelText('Name')).toHaveValue('Old draft');
  });

  it('ignores a draft it cannot read, and copes with storage being blocked', async () => {
    localStorage.setItem(draftKey, '{nope');
    mount();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    expect(screen.getByLabelText('Name')).toHaveValue('x');
    set.mockRestore();
  });
});

describe('CompetitionEditor: when and where', () => {
  const geocodeWith = (impl: () => Promise<unknown>) => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/geocode') return impl();
      if (url === '/auth/me') return { data: {} };
      if (url === '/competitions/access') return { data: [] };
      if (url === '/race-templates') return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
  };

  it('looks the location up when the postcode loses focus, then shows a tick and sends the coordinates', async () => {
    geocodeWith(async () => ({ data: { latitude: 53.33, longitude: -2.38, source: 'postcodes' } }));
    seed('when', { name: 'Spring Games', step: 1 });
    mount();
    await userEvent.type(screen.getByLabelText('Postcode'), 'wa16 6qn');
    await userEvent.tab();
    expect(await screen.findByRole('img', { name: 'Location found' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/geocode', { params: { postcode: 'wa16 6qn', w3w: undefined } });
    expect(stored()).toMatchObject({ lat: '53.33', lon: '-2.38' });
  });

  it('looks up a what3words address, and not the same thing twice', async () => {
    geocodeWith(async () => ({ data: { latitude: 1, longitude: 2, source: 'w3w' } }));
    seed('when');
    mount();
    await userEvent.type(screen.getByLabelText('what3words (optional)'), '///filled.count.soap');
    await userEvent.tab();
    await screen.findByRole('img', { name: 'Location found' });
    await userEvent.click(screen.getByLabelText('Venue'));
    await userEvent.click(screen.getByLabelText('what3words (optional)'));
    await userEvent.tab();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/geocode')).toHaveLength(1);
  });

  it('does nothing when both are empty', async () => {
    seed('when');
    mount();
    await userEvent.click(screen.getByLabelText('Postcode'));
    await userEvent.tab();
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/geocode')).toBe(false);
  });

  it('says so when nothing is found, or the lookup fails', async () => {
    geocodeWith(async () => ({ data: { latitude: null, longitude: null, source: null } }));
    seed('when');
    mount();
    await userEvent.type(screen.getByLabelText('Postcode'), 'zz1');
    await userEvent.tab();
    expect(await screen.findByText('No location found for that.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Postcode'), '2');
    expect(screen.queryByText('No location found for that.')).not.toBeInTheDocument();
    geocodeWith(async () => { throw new Error('down'); });
    await userEvent.tab();
    expect(await screen.findByText('Could not look that up.')).toBeInTheDocument();
  });

  it('shows "Same day" until an end date is chosen', () => {
    seed('when');
    mount();
    expect(screen.getByLabelText('Ends').parentElement).toHaveTextContent('Same day');
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-25' } });
    expect(screen.getByLabelText('Ends').parentElement).not.toHaveTextContent('Same day');
  });

  it('shows the icon chosen', async () => {
    mount();
    await userEvent.selectOptions(screen.getByLabelText('Icon'), 'trophy');
    expect(stored().icon).toBe('trophy');
  });
});

describe('CompetitionEditor: editing', () => {
  const saved = competition({
    id: 7, name: 'Autumn Area', icon: 'trophy', location: 'Tatton', description: 'Notes', organiserName: 'Cheshire PC', paymentDestination: 'Bank 12-34',
    createdByUserId: 'u1', what3Words: 'a.b.c', latitude: 53.1, longitude: -2.2,
    startDate: '2026-10-24T08:30:00', endDate: '2026-10-25T16:00:00',
    sections: [
      { id: 21, competitionId: 7, format: 2, ageGroup: 'Under 12', displayName: 'Under 12 Teams', priceMinor: 4500, maxParticipants: 12, finalistCount: 6, runoffRaceName: '2 Flag', usesRaceFinals: false, activeSignupsCount: 3 },
      { id: 22, competitionId: 7, format: 1, ageGroup: 'Open', displayName: 'Open Pairs', priceMinor: 0 },
    ],
    teams: [team(1, { competitionSectionId: 21 })],
    sessions: [
      session(31, { competitionSectionId: 21, name: 'Under 12 Teams', orderIndex: 1, arenaName: 'Main arena', minutesPerHeat: 8, lanesPerHeat: 6, scheduledStart: '2026-10-24T08:30:00',
        heats: [heat(1, { races: [race(1, { name: 'Bending' })] })] }),
      session(32, { competitionSectionId: 22, name: 'Open Pairs', orderIndex: 2, arenaName: 'Main arena', plannedRaces: ['Bending', 'Bottle'] }),
      session(33, { competitionSectionId: null, kind: 1, isBreak: true, name: 'Lunch', orderIndex: 3, scheduledStart: '2026-10-24T12:00:00', durationMinutes: 30 }),
    ],
  });

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/7') return { data: saved };
      if (url === '/auth/me') return { data: {} };
      if (url === '/competitions/access') return { data: [] };
      if (url === '/race-templates') return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  it('opens the same wizard on the details and lets you jump to any step', async () => {
    mount('/admin/competitions/7');
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit competition' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Autumn Area');
    expect(screen.getByLabelText('Organiser')).toHaveValue('Cheshire PC');
    for (const name of ['Review', 'Structure & timing', 'Races']) expect(screen.getByRole('button', { name })).toBeEnabled();
    await userEvent.click(step('Payment & notes'));
    expect(screen.getByLabelText('How riders pay for now (optional)')).toHaveValue('Bank 12-34');
    expect(screen.getByLabelText('Notes for riders (optional)')).toHaveValue('Notes');
    await userEvent.click(step('When & where'));
    expect(screen.getByLabelText('Venue')).toHaveValue('Tatton');
    expect(screen.getByLabelText('Start time')).toHaveValue('08:30');
    expect(screen.getByLabelText('End time')).toHaveValue('16:00');
    await userEvent.click(step('Sections'));
    const first = screen.getByRole('group', { name: 'Section 1' });
    expect(within(first).getByLabelText('Price')).toHaveValue('45.00');
    expect(within(first).getByLabelText('Max entries')).toHaveValue('12');
    expect(within(first).getByLabelText('Format')).toBeDisabled();
    expect(within(first).getByLabelText('Age group')).toBeDisabled();
    expect(within(first).getByRole('button', { name: 'Remove section 1' })).toBeDisabled();
    expect(first).toHaveTextContent('This age group has entries, so it can’t be removed.');
    expect(within(screen.getByRole('group', { name: 'Section 2' })).getByRole('button', { name: 'Remove section 2' })).toBeEnabled();
  });

  it('shows a session that already has heats as fixed, but still lets minutes and arena change', async () => {
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Structure & timing'));
    const group = screen.getByRole('group', { name: 'Structure for Under 12 Teams' });
    expect(group).toHaveTextContent('structure is fixed');
    expect(within(group).getByLabelText('Sessions')).toBeDisabled();
    expect(within(group).getByLabelText('Max teams per heat')).toBeDisabled();
    expect(within(group).getByLabelText(/Minutes per race/)).toHaveValue('8');
    expect(within(group).getByLabelText(/Minutes per race/)).toBeEnabled();
    expect(group).toHaveTextContent('1 teams entered');
    await userEvent.click(step('Races'));
    expect(screen.getByRole('group', { name: 'Races for Under 12 Teams' })).toHaveTextContent('Heats are made. Change the races on the On the day page.');
    expect(screen.getByRole('group', { name: 'Races for Open Pairs' })).toHaveTextContent('2 races: Bending, Bottle');
  });

  it('saves the details, the age groups and the sessions, and keeps breaks, without touching heats or teams', async () => {
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Sections'));
    const first = screen.getByRole('group', { name: 'Section 1' });
    await userEvent.clear(within(first).getByLabelText('Price'));
    await userEvent.type(within(first).getByLabelText('Price'), '50');
    await userEvent.clear(within(screen.getByRole('group', { name: 'Section 2' })).getByLabelText('Max entries'));
    await userEvent.click(step('Review'));
    await userEvent.click(screen.getByText('Save changes', { selector: 'button' }));
    await waitFor(() => expect(screen.getByText('Competition page')).toBeInTheDocument());

    expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ name: 'Autumn Area', isActive: true, isArchived: false, organiserName: 'Cheshire PC' }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sections/21', expect.objectContaining({ priceMinor: 5000, maxParticipants: 12, finalistCount: 6, runoffRaceName: '2 Flag' }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sections/22', expect.objectContaining({ maxParticipants: 0 }));
    // The session with heats only gets its minutes and arena; the planned one gets the whole structure and an estimated start.
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/31', { minutesPerHeat: 8, arenaName: 'Main arena' });
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/32', expect.objectContaining({ plannedRaces: ['Bending', 'Bottle'], lanesPerHeat: 4, minutesPerHeat: 10, scheduledStart: expect.any(String) }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('never rewrites a session that has been scored', async () => {
    const scored = competition({
      ...saved, sections: [saved.sections[0]],
      sessions: [session(31, { competitionSectionId: 21, name: 'Under 12 Teams', orderIndex: 1, status: 2, minutesPerHeat: 8, heats: [heat(1, { races: [race(1, { isComplete: true })] })] })],
    });
    vi.mocked(api.get).mockImplementation(async (url) => (url === '/competitions/7' ? { data: scored } : url === '/race-templates' ? { data: [] } : { data: {} }) as never);
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Review'));
    await userEvent.click(screen.getByText('Save changes', { selector: 'button' }));
    await waitFor(() => expect(screen.getByText('Competition page')).toBeInTheDocument());
    expect(vi.mocked(api.put).mock.calls.some(([url]) => String(url).includes('/sessions/'))).toBe(false);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('adds new sessions, removes ones taken off, and removes a section and a break that were taken out', async () => {
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Sections'));
    await userEvent.click(screen.getByLabelText('Remove section 2'));
    await userEvent.click(screen.getByText('Add a section', { selector: 'button' }));
    await userEvent.click(step('Structure & timing'));
    await userEvent.selectOptions(within(screen.getByRole('group', { name: 'Structure for Under 12 Teams' })).getByLabelText('Sessions'), '1');
    await userEvent.click(step('Review'));
    await userEvent.click(screen.getByLabelText('Remove Lunch'));
    await userEvent.click(screen.getByText('Save changes', { selector: 'button' }));
    await waitFor(() => expect(screen.getByText('Competition page')).toBeInTheDocument());
    expect(api.delete).toHaveBeenCalledWith('/competitions/7/sections/22');
    expect(api.delete).toHaveBeenCalledWith('/competitions/7/sessions/33');
    expect(api.post).toHaveBeenCalledWith('/competitions/7/sections', expect.objectContaining({ ageGroup: 'Under 10', displayName: 'Under 10 Teams' }));
    const added = vi.mocked(api.post).mock.calls.find(([url]) => url === '/competitions/7/sessions')?.[1] as Record<string, unknown>;
    expect(added).toMatchObject({ competitionSectionId: 51, name: 'Under 10 Teams', orderIndex: expect.any(Number) });
    expect(added.orderIndex as number).toBeGreaterThan(3);
  });

  it('removes extra sessions when the count is lowered', async () => {
    const withTwo = competition({
      ...saved, sections: [saved.sections[1]],
      sessions: [session(40, { competitionSectionId: 22, name: 'A', orderIndex: 1 }), session(41, { competitionSectionId: 22, name: 'B', orderIndex: 2 })],
    });
    vi.mocked(api.get).mockImplementation(async (url) => (url === '/competitions/7' ? { data: withTwo } : url === '/race-templates' ? { data: [] } : { data: {} }) as never);
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Structure & timing'));
    await userEvent.selectOptions(screen.getByLabelText('Sessions'), '1');
    await userEvent.click(step('Review'));
    await userEvent.click(screen.getByText('Save changes', { selector: 'button' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/7/sessions/41'));
    expect(api.delete).not.toHaveBeenCalledWith('/competitions/7/sessions/40');
  });

  it('says so when the competition cannot be loaded', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/7') throw new Error('offline');
      if (url === '/race-templates') return { data: [] };
      return { data: {} } as never;
    });
    mount('/admin/competitions/7');
    expect(await screen.findByText('Could not load competition.')).toBeInTheDocument();
  });

  it('reports a failed save', async () => {
    vi.mocked(api.put).mockRejectedValue({ response: { data: { message: 'Nope.' } } });
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Review'));
    await userEvent.click(screen.getByText('Save changes', { selector: 'button' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saving details failed: Nope.');
    expect(screen.queryByRole('link', { name: 'Open it to finish' })).not.toBeInTheDocument();
  });

  it('stops a trainer who does not own the competition saving it, and lets the owner', async () => {
    localStorage.clear();
    signIn(['Trainer'], 'someone-else');
    const { unmount } = mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Review'));
    expect(screen.getByText('Only admins and trainers can save changes.')).toBeInTheDocument();
    expect(screen.getByText('Save changes', { selector: 'button' })).toBeDisabled();
    unmount();
    localStorage.clear();
    signIn(['Trainer'], 'u1');
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Review'));
    expect(screen.getByText('Save changes', { selector: 'button' })).toBeEnabled();
  });

  it('says where entry fees are paid out, from the event itself', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/7') return { data: { ...saved, payoutsTo: { clubName: 'Cheshire PC', maskedAccount: '\u2022\u2022\u2022\u20221234', ready: true } } };
      if (url === '/race-templates') return { data: [] };
      return { data: {} };
    });
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Payment & notes'));
    expect(await screen.findByText('Entry fees are paid out to Cheshire PC \u2014 \u2022\u2022\u2022\u20221234 \u00b7 Ready')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Set up payouts' })).not.toBeInTheDocument();
    expect(screen.getByText('Test mode: no real money moves yet.')).toBeInTheDocument();
  });

  it('links an admin to Set up payouts when the club is not ready', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/7') return { data: { ...saved, payoutsTo: { clubName: 'Cheshire PC', maskedAccount: null, ready: false } } };
      if (url === '/race-templates') return { data: [] };
      return { data: {} };
    });
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Payment & notes'));
    expect(await screen.findByText(/Cheshire PC hasn't finished setting up payouts yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up payouts' })).toHaveAttribute('href', '/me/payouts');
  });

  it('asks a trainer to get their manager to set payouts up, using the club summary for a new event', async () => {
    localStorage.clear();
    signIn(['Trainer']);
    const auth = JSON.parse(localStorage.getItem('mg.auth')!);
    auth.user.clubId = 5;
    localStorage.setItem('mg.auth', JSON.stringify(auth));
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/clubs/5/payouts/summary') return { data: { clubName: 'Cheshire PC', maskedAccount: null, ready: false } };
      if (url === '/race-templates') return { data: [] };
      return { data: {} };
    });
    seed('payment');
    mount();
    expect(await screen.findByText(/Cheshire PC hasn't finished setting up payouts yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Set up payouts' })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask your club.s manager/)).toBeInTheDocument();
  });

  it('keeps a local draft instead of reloading from the server', async () => {
    seed('about', { name: 'My unsaved edit' }, 'competitionEditor:edit:7');
    mount('/admin/competitions/7');
    expect(await screen.findByDisplayValue('My unsaved edit')).toBeInTheDocument();
  });

  it('shows an age group that is not in the usual list', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => (url === '/competitions/7'
      ? { data: competition({ ...saved, sections: [{ ...saved.sections[0], ageGroup: 'Veterans', displayName: 'Veteran Teams' }], sessions: [] }) }
      : { data: [] }) as never);
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Sections'));
    expect(screen.getByLabelText('Age group')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Veterans' })).toBeInTheDocument();
  });
});
