import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import { defaultDraft, defaultSection, STEP_IDS, type CreatorDraft } from '../../lib/creatorDraft';
import { resetRaceTemplates } from '../../lib/raceTemplates';
import { competition, heat, race, session, team } from '../../test/factories';
import { CompetitionEditor } from './CompetitionEditor';

import { autoConfirm } from '../../test/confirm';
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
      <Route path="/competitions/:id/timetable-and-draw" element={<p>Timetable page</p>} />
    </Routes></MemoryRouter></AuthProvider>,
  );
}

const draftKey = 'competitionEditor:new';
const stored = (key = draftKey) => JSON.parse(localStorage.getItem(key) ?? 'null');
const nextButton = () => screen.getByRole('button', { name: /^Next/ });
const createButton = () => screen.getByRole('button', { name: 'Create competition' });
const next = () => userEvent.click(nextButton());
const nav = () => within(screen.getByRole('navigation', { name: 'Steps' }));
const step = (name: string) => nav().getByRole('button', { name: new RegExp(`^${name}`) });
const h2 = (name: string) => screen.getByRole('heading', { level: 2, name });
type Scope = Pick<typeof screen, 'getByRole'>;
const row = (label: string, scope: Scope = screen) => scope.getByRole('button', { name: new RegExp(`^${label}:`) });
const choose = async (label: string, option: string, scope: Scope = screen) => {
  await userEvent.click(row(label, scope));
  await userEvent.click(screen.getByRole('option', { name: option }));
};
const sw = (name: string) => screen.getByRole('switch', { name });

/** Puts a draft in storage so a test can start at any step with sensible values. */
function seed(at: (typeof STEP_IDS)[number], extra: Partial<CreatorDraft> = {}, key = draftKey) {
  const draft: CreatorDraft = { ...defaultDraft(new Date(2026, 9, 24)), name: 'Spring Games', startDate: '2026-10-24', ...extra, step: STEP_IDS.indexOf(at) };
  localStorage.setItem(key, JSON.stringify(draft));
}

const summary = (id: number, name: string, startDate: string) => ({ id, name, startDate, endDate: null, location: 'Stoneleigh', isActive: true, isArchived: false, sectionCount: 2, teamCount: 0, sessionCount: 0 });

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
  it('opens on Start with a step counter, no Back, and the steps listed down the side', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'New competition' })).toBeInTheDocument();
    expect(h2('Start')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    const steps = nav().getAllByRole('button');
    expect(steps.map((b) => b.textContent?.replace(/^\d+/, ''))).toEqual(['Start', 'About', 'When and where', 'Arenas', 'Sections', 'Structure and timing', 'Races', 'Dec form', 'Payment and rules', 'Review', 'Timetable']);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toBeDisabled();
    expect(steps[10]).toBeDisabled();
  });

  it('moves forward and back, ticking the steps that are done', async () => {
    mount();
    await next();
    expect(h2('About')).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 10')).toBeInTheDocument();
    expect(step('Start')).toHaveAccessibleName('Start, done');
    for (const label of ['Name', 'Organiser']) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Icon:/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring Games');
    await next();
    expect(h2('When and where')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Spring Games');
    // A step already reached can be opened from the list; one beyond cannot.
    await userEvent.click(step('When and where'));
    expect(h2('When and where')).toBeInTheDocument();
    await userEvent.click(step('About'));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(step('Arenas')).toBeDisabled();
  });

  it('walks to the review step, where Next turns into Create competition', async () => {
    mount();
    await next();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring Games');
    for (let i = 0; i < 8; i += 1) await next();
    expect(h2('Review')).toBeInTheDocument();
    expect(screen.getByText('Step 10 of 10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Next/ })).not.toBeInTheDocument();
    expect(createButton()).toBeInTheDocument();
  });

  it('lists the steps in a drawer on a phone', async () => {
    seed('races');
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Steps' }));
    const drawer = screen.getByRole('dialog', { name: 'Steps' });
    expect(within(drawer).getByRole('button', { name: 'Races' })).toHaveAttribute('aria-current', 'step');
    expect(within(drawer).getByRole('button', { name: 'Review' })).toBeDisabled();
    await userEvent.click(within(drawer).getByRole('button', { name: 'When and where, done' }));
    expect(screen.queryByRole('dialog', { name: 'Steps' })).not.toBeInTheDocument();
    expect(h2('When and where')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Steps' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Steps' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Steps' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Steps' })).getAllByRole('button', { name: 'Close' })[1]);
    expect(screen.queryByRole('dialog', { name: 'Steps' })).not.toBeInTheDocument();
  });
});

describe('CompetitionEditor: starting', () => {
  const past = competition({ id: 9, name: 'Spring Open 2026', startDate: '2026-04-25T09:00:00', endDate: '2026-04-26T17:00:00', location: 'Stoneleigh', organiserName: 'Cheshire PC',
    sections: [{ id: 21, competitionId: 9, format: 2, ageGroup: 'Under 12', displayName: 'Under 12', priceMinor: 4500, maxParticipants: 12 }],
    sessions: [session(31, { competitionSectionId: 21, name: 'Under 12', orderIndex: 1, plannedRaces: ['Bending'], arenaName: 'Ring A', lanesPerHeat: 8 })] });

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions') return { data: [summary(8, 'Autumn 2025', '2025-10-04T09:00:00'), summary(9, 'Spring Open 2026', '2026-04-25T09:00:00')] };
      if (url === '/competitions/9') return { data: past };
      if (url === '/race-templates') return { data: [] };
      return { data: {} } as never;
    });
  });

  it('starts from scratch by default, and copying holds Next until a competition is chosen', async () => {
    mount();
    expect(screen.getByRole('button', { name: /^Start from scratch/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /^Copy a past competition/ }));
    expect(screen.getByRole('button', { name: /^Copy a past competition/ })).toHaveAttribute('aria-pressed', 'true');
    expect(nextButton()).toBeDisabled();
    const list = await screen.findByRole('group', { name: 'Copy from' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Spring Open 2026'), expect.stringContaining('Autumn 2025')]);
    expect(screen.getByText('Dates are left empty. Entries and results aren’t copied.')).toBeInTheDocument();
  });

  it('copies a past competition with the dates left empty, and says so on the next steps', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /^Copy a past competition/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Spring Open 2026/ }));
    await waitFor(() => expect(nextButton()).toBeEnabled());
    expect(screen.getByRole('button', { name: /Spring Open 2026/ })).toHaveAttribute('aria-pressed', 'true');
    expect(stored()).toMatchObject({ name: 'Spring Open 2026', startDate: '', endDate: '', startFrom: 'copy', copiedFrom: 'Spring Open 2026', location: 'Stoneleigh' });
    expect(stored().sections[0]).not.toHaveProperty('existingId');
    await next();
    expect(screen.getByText(/Copied from Spring Open 2026\. Set the new dates on When and where\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Spring Open 2026');
    await next();
    expect(row('Starts')).toHaveAccessibleName('Starts: Not set');
    await next();
    expect(screen.getByText('Choose a start date.')).toBeInTheDocument();
    // The arenas come from the copy.
    expect(stored().arenas).toEqual([{ name: 'Ring A', lanes: '8' }]);
  });

  it('goes back to a blank start when scratch is chosen again', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /^Copy a past competition/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Spring Open 2026/ }));
    await waitFor(() => expect(stored().name).toBe('Spring Open 2026'));
    await userEvent.click(screen.getByRole('button', { name: /^Start from scratch/ }));
    expect(stored()).toMatchObject({ name: '', startFrom: 'scratch' });
    expect(stored().copiedFrom).toBeUndefined();
    expect(screen.queryByRole('group', { name: 'Copy from' })).not.toBeInTheDocument();
  });

  it('says so when the list or a copy cannot be loaded', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions') throw new Error('offline');
      return { data: [] } as never;
    });
    mount();
    await userEvent.click(screen.getByRole('button', { name: /^Copy a past competition/ }));
    expect(await screen.findByText('Couldn’t load your competitions.')).toBeInTheDocument();
  });

  it('says so when one competition cannot be copied', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions') return { data: [summary(9, 'Spring Open 2026', '2099-04-25T09:00:00')] };
      if (url === '/competitions/9') throw new Error('offline');
      return { data: [] } as never;
    });
    mount();
    await userEvent.click(screen.getByRole('button', { name: /^Copy a past competition/ }));
    const pick = await screen.findByRole('button', { name: /Spring Open 2026/ });
    expect(pick).toHaveTextContent('Upcoming');
    await userEvent.click(pick);
    expect(await screen.findByText('Couldn’t copy that one. Try again.')).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
  });

  it('says when there are no competitions to copy', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => (url === '/competitions' ? { data: 'not a list' } : { data: [] }) as never);
    mount();
    await userEvent.click(screen.getByRole('button', { name: /^Copy a past competition/ }));
    expect(await screen.findByText('No past competitions yet.')).toBeInTheDocument();
  });
});

describe('CompetitionEditor: validation one step at a time', () => {
  it('needs a name before leaving About, takes focus to it and clears the message when fixed', async () => {
    seed('about', { name: '' });
    mount();
    await next();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByLabelText('Name').parentElement).toHaveAttribute('data-invalid', 'true');
    expect(h2('About')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'S');
    expect(screen.getByLabelText('Name')).not.toHaveAccessibleDescription('Enter a name.');
    await next();
    expect(h2('When and where')).toBeInTheDocument();
  });

  it('needs a start date, and an end that is not before the start', async () => {
    seed('when', { startDate: '' });
    mount();
    await next();
    expect(screen.getByText('Choose a start date.')).toBeInTheDocument();
    expect(h2('When and where')).toBeInTheDocument();
  });

  it('refuses an end before the start, then moves on once it is fixed', async () => {
    seed('when', { endDate: '2026-10-23' });
    mount();
    await next();
    expect(screen.getByText('The end can’t be before the start.')).toBeInTheDocument();
    await userEvent.click(row('Ends'));
    await userEvent.click(screen.getByRole('gridcell', { name: 'Sunday 25 October' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await next();
    expect(h2('Arenas')).toBeInTheDocument();
  });

  it('needs every arena named once', async () => {
    seed('arenas', { arenas: [{ name: 'Ring', lanes: '6' }, { name: 'ring', lanes: '6' }] });
    mount();
    await next();
    expect(screen.getByText('Two arenas have the same name.')).toBeInTheDocument();
    expect(h2('Arenas')).toBeInTheDocument();
  });

  it('stops on the structure step for minutes that make no sense', async () => {
    seed('structure', { sections: [{ ...defaultSection(), minutesPerRace: '0' }] });
    mount();
    await next();
    expect(within(screen.getByRole('group', { name: 'Structure for Seniors' })).getByText('Minutes per heat must be from 1 to 180.')).toBeInTheDocument();
    expect(h2('Structure and timing')).toBeInTheDocument();
  });
});

describe('CompetitionEditor: about', () => {
  it('picks an icon from every country, with a search box', async () => {
    seed('about');
    mount();
    await userEvent.click(row('Icon'));
    const list = screen.getByRole('listbox', { name: 'Icon' });
    expect(within(list).getAllByRole('option').length).toBeGreaterThan(250);
    await userEvent.type(screen.getByLabelText('Search icons'), 'ire');
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Northern Ireland', 'Côte d’Ivoire', 'Ireland']);
    await userEvent.click(within(list).getByRole('option', { name: 'Ireland' }));
    expect(stored().icon).toBe('ie');
    expect(row('Icon')).toHaveAccessibleName('Icon: Ireland');
    expect(row('Icon').querySelector('img')).toHaveAttribute('src', '/flags/ie.png');
  });

  it('has a picture for a country that is not in the old list, and says when nothing matches', async () => {
    seed('about');
    mount();
    await userEvent.click(row('Icon'));
    await userEvent.type(screen.getByLabelText('Search icons'), 'zzz');
    expect(screen.getByText('No match.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search icons'));
    await userEvent.type(screen.getByLabelText('Search icons'), 'afghan');
    await userEvent.click(screen.getByRole('option', { name: 'Afghanistan' }));
    expect(stored().icon).toBe('af');
    expect(row('Icon').querySelector('img')).toHaveAttribute('src', '/flags/af.svg');
    await userEvent.click(row('Icon'));
    await userEvent.click(screen.getByRole('option', { name: 'Trophy' }));
    expect(stored().icon).toBe('trophy');
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

  it('sets the start from a month calendar, ringing the event’s days, and a time', async () => {
    seed('when', { endDate: '2026-10-25' });
    mount();
    await userEvent.click(row('Starts'));
    const dialog = screen.getByRole('dialog', { name: 'Starts' });
    expect(within(dialog).getByRole('gridcell', { name: 'Saturday 24 October' })).toHaveClass('rf-cal-event');
    expect(within(dialog).getByRole('gridcell', { name: 'Sunday 25 October' })).toHaveClass('rf-cal-event');
    expect(within(dialog).getByRole('gridcell', { name: 'Friday 23 October' })).not.toHaveClass('rf-cal-event');
    await userEvent.click(within(dialog).getByRole('gridcell', { name: 'Thursday 15 October' }));
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '08:30' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(stored()).toMatchObject({ startDate: '2026-10-15', startTime: '08:30' });
    expect(row('Starts')).toHaveAccessibleName(expect.stringContaining('15 Oct'));
  });

  it('keeps the old value when the calendar is closed without Done', async () => {
    seed('when');
    mount();
    await userEvent.click(row('Starts'));
    await userEvent.click(screen.getByRole('gridcell', { name: 'Thursday 15 October' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Starts' })).not.toBeInTheDocument();
    expect(stored()).toMatchObject({ startDate: '2026-10-24', startTime: '09:00' });
  });

  it('sets and removes the end, which means the same day', async () => {
    seed('when');
    mount();
    expect(row('Ends')).toHaveAccessibleName('Ends: Not set');
    expect(screen.getByText('No end set: it finishes the same day.')).toBeInTheDocument();
    await userEvent.click(row('Ends'));
    await userEvent.click(screen.getByRole('gridcell', { name: 'Sunday 25 October' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(stored()).toMatchObject({ endDate: '2026-10-25', endTime: '09:00' });
    expect(screen.queryByText('No end set: it finishes the same day.')).not.toBeInTheDocument();
    await userEvent.click(row('Ends'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(stored().endDate).toBe('');
    expect(row('Ends')).toHaveAccessibleName('Ends: Not set');
  });

  it('looks the location up when the postcode loses focus, then shows a tick and sends the coordinates', async () => {
    geocodeWith(async () => ({ data: { latitude: 53.33, longitude: -2.38, source: 'postcodes' } }));
    seed('when', { name: 'Spring Games' });
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
});

describe('CompetitionEditor: arenas', () => {
  it('adds and removes arenas, names them and sets their lanes', async () => {
    seed('arenas');
    mount();
    expect(screen.getByLabelText('Arena 1')).toHaveValue('Main arena');
    await userEvent.click(screen.getByRole('button', { name: 'More: Number of arenas' }));
    expect(screen.getByLabelText('Arena 2')).toHaveValue('Arena 2');
    expect(stored().arenas).toHaveLength(2);
    await userEvent.type(screen.getByLabelText('Arena 2'), ' (grass)');
    expect(stored().arenas[1].name).toBe('Arena 2 (grass)');
    const lanes = screen.getByRole('group', { name: 'Max lanes, Arena 2 (grass)' });
    await userEvent.click(within(lanes).getByRole('button', { name: /^Less/ }));
    expect(stored().arenas[1].lanes).toBe('5');
    fireEvent.change(within(lanes).getByRole('spinbutton'), { target: { value: '99' } });
    expect(stored().arenas[1].lanes).toBe('12');
    await userEvent.click(screen.getByRole('button', { name: 'Less: Number of arenas' }));
    expect(screen.queryByLabelText('Arena 2')).not.toBeInTheDocument();
  });

  it('takes the age groups along when an arena is renamed or its lanes change', async () => {
    seed('arenas');
    mount();
    await userEvent.clear(screen.getByLabelText('Arena 1'));
    await userEvent.type(screen.getByLabelText('Arena 1'), 'Ring A');
    await userEvent.click(screen.getByRole('button', { name: 'More: Max lanes, Ring A' }));
    expect(stored().sections[0]).toMatchObject({ arena: 'Ring A', maxTeamsPerHeat: '7' });
  });
});

describe('CompetitionEditor: sections', () => {
  it('starts with one Seniors section, and adds and removes sections', async () => {
    seed('sections');
    mount();
    const group = screen.getByRole('group', { name: 'Seniors' });
    expect(row('Type', within(group))).toHaveAccessibleName('Type: Teams');
    expect(row('Age group', within(group))).toHaveAccessibleName('Age group: Seniors');
    expect(within(group).getByRole('spinbutton', { name: 'Price in pounds, Seniors' })).toHaveValue(0);
    expect(within(group).getByRole('spinbutton', { name: 'Max entries, Seniors' })).toHaveValue(null);
    expect(within(group).getByRole('button', { name: 'Remove Seniors' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Add a section' }));
    const second = screen.getByRole('group', { name: 'Under 8' });
    expect(within(second).getByRole('spinbutton', { name: 'Max entries, Under 8' })).toHaveValue(10);
    expect(stored().sections[1]).toMatchObject({ ageGroup: 'Under 8', arena: 'Main arena', maxTeamsPerHeat: '6' });
    await userEvent.click(within(group).getByRole('button', { name: 'Remove Seniors' }));
    expect(screen.queryByRole('group', { name: 'Seniors' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Under 8' })).toBeInTheDocument();
  });

  it('names a section by its age group and then its type, and lets you type your own age group', async () => {
    seed('sections');
    mount();
    const group = screen.getByRole('group', { name: 'Seniors' });
    await choose('Type', 'Pairs', within(group));
    expect(screen.getByRole('group', { name: 'Senior Pairs' })).toBeInTheDocument();
    await choose('Age group', 'Under 15');
    expect(screen.getByRole('group', { name: 'Under 15 Pairs' })).toBeInTheDocument();
    await choose('Type', 'Teams');
    expect(screen.getByRole('group', { name: 'Under 15' })).toBeInTheDocument();
    await userEvent.click(row('Age group'));
    await userEvent.click(screen.getByRole('option', { name: 'Other…' }));
    await userEvent.type(screen.getByLabelText('Age group, your own'), 'Veterans');
    await userEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(stored().sections[0]).toMatchObject({ format: 2, ageGroup: 'Veterans' });
    await choose('Type', 'Individual');
    expect(screen.getByRole('group', { name: 'Veteran Individuals' })).toBeInTheDocument();
    expect(stored().sections[0]).toMatchObject({ format: 3, maxTeamsPerHeat: '6' });
  });

  it('refuses the same age group twice in one type', async () => {
    seed('sections', { sections: [defaultSection(), defaultSection()] });
    mount();
    await next();
    expect(screen.getByText('You already have this age group in this format.')).toBeInTheDocument();
  });

  it('steps the price from £0 to £500 and the entries from 1 to 60, and keeps typed numbers inside those', async () => {
    seed('sections');
    mount();
    const price = screen.getByRole('spinbutton', { name: 'Price in pounds, Seniors' });
    const entries = screen.getByRole('spinbutton', { name: 'Max entries, Seniors' });
    expect(screen.getByRole('button', { name: 'Less: Price in pounds, Seniors' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'More: Price in pounds, Seniors' }));
    await userEvent.click(screen.getByRole('button', { name: 'More: Price in pounds, Seniors' }));
    expect(stored().sections[0].priceGbp).toBe('2');
    fireEvent.change(price, { target: { value: '9999' } });
    expect(stored().sections[0].priceGbp).toBe('500');
    expect(screen.getByRole('button', { name: 'More: Price in pounds, Seniors' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Less: Price in pounds, Seniors' }));
    expect(stored().sections[0].priceGbp).toBe('499');
    fireEvent.change(price, { target: { value: '0' } });
    expect(stored().sections[0].priceGbp).toBe('');

    expect(screen.getByRole('button', { name: 'Less: Max entries, Seniors' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'More: Max entries, Seniors' }));
    expect(stored().sections[0].maxParticipants).toBe('10');
    fireEvent.change(entries, { target: { value: '99' } });
    expect(stored().sections[0].maxParticipants).toBe('60');
    fireEvent.change(entries, { target: { value: '0' } });
    expect(stored().sections[0].maxParticipants).toBe('1');
    fireEvent.change(entries, { target: { value: '' } });
    expect(stored().sections[0].maxParticipants).toBe('1');
  });
});

describe('CompetitionEditor: structure and timing', () => {
  it('shows an estimate that follows the numbers, and changes the sessions', async () => {
    seed('structure', { sections: [{ ...defaultSection(), maxParticipants: '40', maxTeamsPerHeat: '4', minutesPerRace: '5' }] });
    mount();
    const group = screen.getByRole('group', { name: 'Structure for Seniors' });
    expect(group).toHaveTextContent('Estimate: about 10 teams, from the entry limit, 3 heats (4, 3, 3), about 15 min a session.');
    await userEvent.click(within(group).getByRole('button', { name: 'More: Sessions, Seniors' }));
    expect(stored().sections[0].sessions).toHaveLength(2);
    expect(stored().sections[0].sessions[1]).toMatchObject({ sameAsFirst: true });
    await userEvent.click(within(group).getByRole('button', { name: 'More: Minutes per heat, Seniors' }));
    expect(stored().sections[0].minutesPerRace).toBe('10');
  });

  it('turns Heat, heat, final on, which runs as one session with no lane order or final options', async () => {
    seed('structure', { sections: [{ ...defaultSection(), sessions: [{ races: null }, { races: null }] }] });
    mount();
    const group = screen.getByRole('group', { name: 'Structure for Seniors' });
    expect(row('Lane after each race', within(group))).toBeInTheDocument();
    await choose('Format', 'Heat, heat, final', within(group));
    expect(stored().sections[0]).toMatchObject({ usesRaceFinals: true });
    expect(stored().sections[0].sessions).toHaveLength(1);
    expect(within(group).getByRole('button', { name: 'More: Sessions, Seniors' })).toBeDisabled();
    expect(within(group).queryByRole('button', { name: /^Lane after each race/ })).not.toBeInTheDocument();
    expect(within(group).queryByRole('switch')).not.toBeInTheDocument();
    expect(group).toHaveTextContent('qualifier heats and a final for each race');
    expect(group).toHaveTextContent('runs as one session');
    await choose('Format', 'Standard', within(group));
    expect(stored().sections[0].usesRaceFinals).toBe(false);
  });

  it('sets the tie-break, the run-off race and the lane order', async () => {
    seed('structure');
    mount();
    const group = screen.getByRole('group', { name: 'Structure for Seniors' });
    expect(row('Tie-break', within(group))).toHaveAccessibleName('Tie-break: Countback');
    expect(within(group).queryByRole('button', { name: /^Run-off race/ })).not.toBeInTheDocument();
    await choose('Tie-break', 'Run-off', within(group));
    expect(stored().sections[0].tieBreak).toBe(2);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/race-templates'));
    await userEvent.click(row('Run-off race', within(group)));
    await userEvent.click(await screen.findByRole('option', { name: 'Speed Weave' }));
    expect(stored().sections[0].runoffRaceName).toBe('Speed Weave');
    await choose('Tie-break', 'Last race', within(group));
    expect(stored().sections[0].tieBreak).toBe(1);
    expect(within(group).queryByRole('button', { name: /^Run-off race/ })).not.toBeInTheDocument();
    await choose('Lane after each race', 'Stay in lane', within(group));
    expect(stored().sections[0].laneRotation).toBe(1);
  });

  it('sets the final’s points with switches, for a standard section only', async () => {
    seed('structure');
    mount();
    expect(sw('Carry points into the final')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Double points in the final')).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw('Double points in the final'));
    await userEvent.click(sw('Carry points into the final'));
    expect(stored().sections[0]).toMatchObject({ doublePointsInFinal: true, carryPointsIntoFinal: false });
  });

  it('lets each age group pick its arena, with heats that fit its lanes', async () => {
    seed('structure', { arenas: [{ name: 'Main arena', lanes: '6' }, { name: 'Ring B', lanes: '4' }] });
    mount();
    await choose('Arena', 'Ring B');
    expect(stored().sections[0]).toMatchObject({ arena: 'Ring B', maxTeamsPerHeat: '4' });
  });

  it('has no arena row when there is only one', () => {
    seed('structure');
    mount();
    expect(screen.queryByRole('button', { name: /^Arena:/ })).not.toBeInTheDocument();
  });

  it('lists the hatbands under the age groups, one for each lane of the biggest arena', () => {
    seed('structure');
    mount();
    const hats = screen.getByRole('group', { name: 'Hatbands' });
    expect(within(hats).getAllByRole('button', { name: /^Move .* up$/ })).toHaveLength(6);
  });
});

describe('CompetitionEditor: races', () => {
  it('can be skipped: nothing is required', async () => {
    seed('races');
    mount();
    expect(screen.getByText('No races yet')).toBeInTheDocument();
    await next();
    expect(h2('Dec form')).toBeInTheDocument();
    expect(screen.getByText(/A new competition starts with the basics/)).toBeInTheDocument();
    await next();
    expect(h2('Payment and rules')).toBeInTheDocument();
  });

  it('fills a session from a preset list and puts it back to later', async () => {
    seed('races');
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Use a preset list' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use the Pony Club Area list' }));
    expect(within(screen.getByRole('list', { name: 'Races, Session 1' })).getAllByRole('listitem')).toHaveLength(8);
    expect(stored().sections[0].sessions[0].races).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: 'Use a preset list' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('button', { name: 'Use the Pony Club Zone list' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Leave for later' }));
    expect(screen.getByText('No races yet')).toBeInTheDocument();
    expect(stored().sections[0].sessions[0].races).toBeNull();
  });

  it('adds a race from the library or by name, and removes one', async () => {
    seed('races');
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Add a race' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /2 Flag/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /2 Flag/ }));
    expect(stored().sections[0].sessions[0].races).toEqual(['2 Flag']);
    // A race already in the list is not offered again.
    expect(screen.queryByRole('button', { name: /^2 Flag/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Find a race'), 'Hurdles');
    expect(screen.getByRole('button', { name: /Add “Hurdles”/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add “Hurdles”/ }));
    expect(stored().sections[0].sessions[0].races).toEqual(['2 Flag', 'Hurdles']);
    await userEvent.type(screen.getByLabelText('Find a race'), 'zzzz');
    expect(screen.getByRole('button', { name: /Add “zzzz”/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Find a race')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove 2 Flag' }));
    expect(stored().sections[0].sessions[0].races).toEqual(['Hurdles']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Hurdles' }));
    expect(stored().sections[0].sessions[0].races).toBeNull();
  });

  it('says when nothing in the library matches', async () => {
    seed('races', { sections: [{ ...defaultSection(), sessions: [{ races: ['2 Flag', 'Speed Weave'] }] }] });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Add a race' }));
    await waitFor(() => expect(screen.getByText('No match.')).toBeInTheDocument());
  });

  it('puts races in order with the arrow keys on the grip, which keeps focus', async () => {
    seed('races', { sections: [{ ...defaultSection(), sessions: [{ races: ['Bending', 'Flag Race', 'Sack Race'] }] }] });
    mount();
    const grip = screen.getByRole('button', { name: 'Move Bending: drag, or use the up and down arrow keys' });
    expect(screen.queryByRole('button', { name: /move .* (up|down)$/i })).not.toBeInTheDocument();
    grip.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(stored().sections[0].sessions[0].races).toEqual(['Bending', 'Flag Race', 'Sack Race']);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(stored().sections[0].sessions[0].races).toEqual(['Flag Race', 'Sack Race', 'Bending']);
    expect(grip).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}x');
    expect(stored().sections[0].sessions[0].races).toEqual(['Flag Race', 'Sack Race', 'Bending']);
  });

  it('puts races in order by dragging the grip: the row lifts and drops where it is let go', () => {
    seed('races', { sections: [{ ...defaultSection(), sessions: [{ races: ['Bending', 'Flag Race', 'Sack Race', 'Mug Race'] }] }] });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 56, width: 400, top: 0, left: 0, right: 400, bottom: 56, x: 0, y: 0, toJSON: () => ({}) });
    mount();
    const grip = screen.getByRole('button', { name: 'Move Bending: drag, or use the up and down arrow keys' });
    fireEvent(grip, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientY: 100 }));
    const rowOf = (name: string) => screen.getByText(name).closest('[data-race-row]') as HTMLElement;
    expect(rowOf('Bending')).toHaveAttribute('data-lifted', 'true');
    fireEvent(window, new MouseEvent('pointermove', { clientY: 100 + 120 }));
    // Two rows down: the lifted row follows the pointer and the two rows it passed move up.
    expect(rowOf('Bending').style.transform).toBe('translateY(120px)');
    expect(rowOf('Flag Race').style.transform).toBe('translateY(-56px)');
    expect(rowOf('Sack Race').style.transform).toBe('translateY(-56px)');
    expect(rowOf('Mug Race').style.transform).toBe('');
    fireEvent(window, new MouseEvent('pointerup', {}));
    expect(stored().sections[0].sessions[0].races).toEqual(['Flag Race', 'Sack Race', 'Bending', 'Mug Race']);
    expect(rowOf('Bending')).toHaveAttribute('data-lifted', 'false');
    expect(rowOf('Bending').style.transform).toBe('');
  });

  it('leaves the list alone when a drag ends where it began, and ignores other mouse buttons', () => {
    seed('races', { sections: [{ ...defaultSection(), sessions: [{ races: ['Bending', 'Flag Race'] }] }] });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 56, width: 400, top: 0, left: 0, right: 400, bottom: 56, x: 0, y: 0, toJSON: () => ({}) });
    mount();
    const grip = screen.getByRole('button', { name: 'Move Bending: drag, or use the up and down arrow keys' });
    fireEvent(grip, new MouseEvent('pointerdown', { bubbles: true, button: 2, clientY: 100 }));
    expect(screen.getByText('Bending').closest('[data-race-row]')).toHaveAttribute('data-lifted', 'false');
    fireEvent(grip, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }));
    fireEvent(window, new MouseEvent('pointermove', { clientY: 110 }));
    fireEvent(window, new MouseEvent('pointercancel', {}));
    expect(stored().sections[0].sessions[0].races).toEqual(['Bending', 'Flag Race']);
    // After a drag has ended, moving the pointer does nothing.
    fireEvent(window, new MouseEvent('pointermove', { clientY: 300 }));
    expect(screen.getByText('Bending').closest('[data-race-row]')).toHaveAttribute('data-lifted', 'false');
  });

  it('gives each session a tab, and a session can follow Session 1', async () => {
    seed('races', { sections: [{ ...defaultSection(), sessions: [{ races: ['Bending', 'Flag Race'] }, { races: ['Bending', 'Flag Race'], sameAsFirst: true }] }] });
    mount();
    expect(within(screen.getByRole('tablist', { name: 'Race list for' })).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Session 1', 'Session 2', 'Final']);
    await userEvent.click(screen.getByRole('tab', { name: 'Session 2' }));
    expect(sw('Same races as Session 1')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a race' })).not.toBeInTheDocument();
    // Changing Session 1 changes Session 2 too.
    await userEvent.click(screen.getByRole('tab', { name: 'Session 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Flag Race' }));
    expect(stored().sections[0].sessions.map((s: { races: string[] }) => s.races)).toEqual([['Bending'], ['Bending']]);
    // Turn following off and it can change on its own.
    await userEvent.click(screen.getByRole('tab', { name: 'Session 2' }));
    await userEvent.click(sw('Same races as Session 1'));
    expect(stored().sections[0].sessions[1].sameAsFirst).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bending' }));
    expect(stored().sections[0].sessions.map((s: { races: string[] | null }) => s.races)).toEqual([['Bending'], null]);
    // And on again copies Session 1's list.
    await userEvent.click(sw('Same races as Session 1'));
    expect(stored().sections[0].sessions[1]).toMatchObject({ races: ['Bending'], sameAsFirst: true });
  });

  it('adds and removes the final, and a section with a final says so on its tab', async () => {
    seed('races', { sections: [{ ...defaultSection(), hasFinal: false }] });
    mount();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add a final' }));
    expect(stored().sections[0].hasFinal).toBe(true);
    expect(screen.getByRole('tab', { name: 'Final', selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use a preset list' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use the Pony Club Zone list' }));
    expect(stored().sections[0].finalRaces).toHaveLength(10);
    expect(screen.queryByRole('switch', { name: 'Same races as Session 1' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove the final' }));
    expect(stored().sections[0].hasFinal).toBe(false);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a final' })).toBeInTheDocument();
  });

  it('makes one final for each heat of entries, and each final has its own races', async () => {
    seed('races', { sections: [{ ...defaultSection(), maxParticipants: '12', maxTeamsPerHeat: '6' }] });
    mount();
    expect(screen.getByText('12 entries in heats of 6, so 2 finals')).toBeInTheDocument();
    expect(within(screen.getByRole('tablist', { name: 'Race list for' })).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Session 1', 'A final', 'B final']);
    await userEvent.click(screen.getByRole('tab', { name: 'B final' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use a preset list' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use the Pony Club Area list' }));
    expect(stored().sections[0].finalRacesB).toHaveLength(8);
    expect(stored().sections[0].finalRaces).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove the finals' }));
    expect(screen.queryByRole('tab', { name: 'A final' })).not.toBeInTheDocument();
  });

  it('shows a session that already has heats as fixed', () => {
    seed('races', { sections: [{ ...defaultSection(), sessions: [{ races: ['Bending'], hasHeats: true }], finalHasHeats: true, finalRaces: ['Flag'] }] });
    mount();
    expect(screen.getByText('Heats are made. Change the races on the On the day page.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a race' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave for later' })).not.toBeInTheDocument();
    expect(screen.getByText('Bending')).toBeInTheDocument();
  });
});

describe('CompetitionEditor: payment and rules', () => {
  it('takes how riders pay, notes and terms, and the switches for cards and the passport check', async () => {
    seed('payment');
    mount();
    await userEvent.type(screen.getByLabelText(/^How riders pay for now/), 'Bank');
    await userEvent.type(screen.getByLabelText(/^Notes for riders/), 'Wear hats');
    await userEvent.type(screen.getByLabelText(/^Terms and conditions/), 'Be kind');
    expect(stored()).toMatchObject({ paymentDestination: 'Bank', description: 'Wear hats', termsText: 'Be kind' });
    expect(sw('Yellow and red cards')).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw('Yellow and red cards'));
    await userEvent.click(sw('Passport and vaccination check'));
    expect(stored()).toMatchObject({ cardsEnabled: true, passportCheck: true });
    await userEvent.click(sw('Passport and vaccination check'));
    expect(stored().passportCheck).toBe(false);
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

  it('says that payouts go to the club once it has set them up, when there is no club summary', () => {
    seed('payment');
    mount();
    expect(screen.getByText('Payouts go to your club once it has set them up.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up payouts' })).toHaveAttribute('href', '/me/payouts');
  });
});

describe('CompetitionEditor: review', () => {
  it('shows each part with an Edit button that goes back to its step', async () => {
    seed('review', {
      organiserName: 'Cheshire PC', location: 'Tatton', postcode: 'WA16 6QN', what3Words: '///a.b.c', endDate: '2026-10-25', icon: 'ie',
      arenas: [{ name: 'Main arena', lanes: '6' }, { name: 'Ring B', lanes: '4' }],
      sections: [{ ...defaultSection(), maxParticipants: '24', priceGbp: '12.5', arena: 'Ring B', finalistCount: '4', tieBreak: 1, laneRotation: 2, doublePointsInFinal: true }],
      paymentDestination: 'Bank', description: 'Notes', cardsEnabled: true, passportCheck: true,
    });
    mount();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Spring Games');
    expect(text).toContain('Cheshire PC · Ireland');
    expect(text).toContain('Tatton, WA16 6QN, ///a.b.c');
    expect(text).toContain('Main arena6 lanesRing B4 lanes');
    expect(text).toContain('Teams · £12.50 · up to 24 entries');
    expect(text).toContain('Standard · 1 session · 10 min a heat · Ring B · 4 through to the final');
    expect(text).toContain('Tie-break: last race · lanes moving down one · points carried into the final · double points in the final');
    expect(text).toContain('Pay: Bank · Notes added');
    expect(text).toContain('Yellow and red cards · passport check');
    for (const [label, heading] of [['About', 'About'], ['When and where', 'When and where'], ['Arenas', 'Arenas'], ['Sections', 'Sections'], ['Hatbands', 'Structure and timing'], ['Dec form', 'Dec form'], ['Payment and rules', 'Payment and rules']]) {
      await userEvent.click(screen.getByRole('button', { name: `Edit ${label}` }));
      expect(h2(heading)).toBeInTheDocument();
      await userEvent.click(step('Review'));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Edit races for Seniors' }));
    expect(h2('Races')).toBeInTheDocument();
  });

  it('shows the races on each tab as chips, and which sessions follow the first', () => {
    seed('review', {
      sections: [{ ...defaultSection(), maxParticipants: '12', sessions: [{ races: ['Bending', 'Flag Race'] }, { races: ['Bending', 'Flag Race'], sameAsFirst: true }, { races: null }], finalRaces: ['Mug'] }],
    });
    mount();
    expect(screen.getByText('1. Bending')).toBeInTheDocument();
    expect(screen.getByText('2. Flag Race')).toBeInTheDocument();
    expect(screen.getByText('Same as Session 1')).toBeInTheDocument();
    expect(screen.getAllByText('Races to be chosen later')).toHaveLength(2);
    expect(screen.getByText('1. Mug')).toBeInTheDocument();
  });

  it('shows no hatbands, an undated competition and a missing venue plainly', () => {
    seed('review', { startDate: '', name: '', noHatbands: true });
    mount();
    expect(screen.getByText('Untitled competition')).toBeInTheDocument();
    expect(screen.getByText('Dates to set')).toBeInTheDocument();
    expect(screen.getByText('No venue yet')).toBeInTheDocument();
    expect(screen.getByText('No hatbands')).toBeInTheDocument();
    expect(screen.getByText('How to pay not set · No notes')).toBeInTheDocument();
    expect(screen.getByText('No cards · no passport check')).toBeInTheDocument();
  });

  it('warns when the day runs past its end time, and notes races that are not chosen', () => {
    seed('review', { startTime: '09:00', endTime: '09:30', sections: [{ ...defaultSection(), minutesPerRace: '60' }] });
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent('The timetable runs until');
    expect(screen.getByText(/Races aren’t chosen for 1 session/)).toBeInTheDocument();
  });

  it('adds a break and a briefing, and removes one', async () => {
    seed('review', { startTime: '09:00' });
    mount();
    expect(screen.getByText(/None yet\. Add a lunch break/)).toBeInTheDocument();
    const form = screen.getByRole('group', { name: 'Add a break or briefing' });
    await userEvent.clear(within(form).getByLabelText('Name'));
    await userEvent.type(within(form).getByLabelText('Name'), 'Lunch');
    await userEvent.clear(within(form).getByLabelText('Minutes'));
    await userEvent.type(within(form).getByLabelText('Minutes'), '45');
    await userEvent.click(within(form).getByRole('button', { name: 'Add to timetable' }));
    expect(stored().breaks).toEqual([expect.objectContaining({ name: 'Lunch', minutes: '45', kind: 1 })]);
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Remove Lunch'));
    expect(stored().breaks).toEqual([]);
  });

  it('asks for a sensible length and start when adding a break', async () => {
    seed('review');
    mount();
    const form = screen.getByRole('group', { name: 'Add a break or briefing' });
    await userEvent.selectOptions(within(form).getByLabelText('Type'), 'Briefing');
    await userEvent.clear(within(form).getByLabelText('Minutes'));
    await userEvent.click(within(form).getByRole('button', { name: 'Add to timetable' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Enter how many minutes it lasts.');
    await userEvent.type(within(form).getByLabelText('Minutes'), '15');
    fireEvent.change(within(form).getByLabelText('Starts'), { target: { value: '' } });
    await userEvent.click(within(form).getByRole('button', { name: 'Add to timetable' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose when it starts.');
    fireEvent.change(within(form).getByLabelText('Starts'), { target: { value: '08:30' } });
    await userEvent.click(within(form).getByRole('button', { name: 'Add to timetable' }));
    expect(stored().breaks).toEqual([expect.objectContaining({ kind: 2, minutes: '15', time: '08:30' })]);
  });
});

describe('CompetitionEditor: creating', () => {
  it('creates the competition, its age groups, sessions with estimated starts, and breaks, then offers a timetable', async () => {
    seed('review', {
      organiserName: 'Cheshire PC', location: 'Tatton', description: 'Notes', paymentDestination: 'Bank', termsText: 'T', passportCheck: true,
      sections: [
        { ...defaultSection(), ageGroup: 'Juniors', format: 3, priceGbp: '12.5', maxParticipants: '16', finalistCount: '6', runoffRaceName: '2 Flag', minutesPerRace: '5', maxTeamsPerHeat: '4', tieBreak: 2, sessions: [{ races: ['Bending', 'Bottle'] }, { races: null }] },
        { ...defaultSection(), ageGroup: 'Open', usesRaceFinals: true, arena: 'Arena 2' },
      ],
      arenas: [{ name: 'Main arena', lanes: '6' }, { name: 'Arena 2', lanes: '6' }],
      breaks: [{ kind: 1, name: 'Lunch', date: '2026-10-24', time: '12:00', minutes: '30', arena: '' }],
    });
    mount();
    await userEvent.click(createButton());
    expect(await screen.findByRole('heading', { level: 2, name: 'Competition created' })).toBeInTheDocument();

    expect(api.post).toHaveBeenCalledWith('/competitions', expect.objectContaining({
      name: 'Spring Games', organiserName: 'Cheshire PC', location: 'Tatton', paymentDestination: 'Bank', termsText: 'T', description: 'Notes',
      startDate: new Date('2026-10-24T09:00').toISOString(), endDate: new Date('2026-10-24T17:00').toISOString(),
      laneHatbands: ['Red', 'White', 'Blue', 'Yellow', 'Green', 'Black'],
    }));
    expect(api.put).toHaveBeenCalledWith('/event-tools/competitions/41/passport-check/settings', { enabled: true });
    expect(api.post).toHaveBeenCalledWith('/competitions/41/sections', {
      format: 3, ageGroup: 'Juniors', displayName: 'Junior Individuals', runoffRaceName: '2 Flag', usesRaceFinals: false, priceMinor: 1250, maxParticipants: 16, finalistCount: 6, tieBreakRule: 2,
      hasFinal: true, carryPointsIntoFinal: true, doublePointsInFinal: false,
    });
    expect(api.post).toHaveBeenCalledWith('/competitions/41/sections', expect.objectContaining({ ageGroup: 'Open', displayName: 'Open', usesRaceFinals: true }));
    expect(vi.mocked(api.post).mock.calls.find(([, body]) => (body as { ageGroup?: string }).ageGroup === 'Open')?.[1]).not.toHaveProperty('hasFinal');
    expect(vi.mocked(api.post).mock.calls.find(([, body]) => (body as { ageGroup?: string }).ageGroup === 'Open')?.[1]).not.toHaveProperty('tieBreakRule');
    const sessions = vi.mocked(api.post).mock.calls.filter(([url]) => url === '/competitions/41/sessions').map(([, body]) => body as Record<string, unknown>);
    expect(sessions.map((s) => s.name)).toEqual(['Junior Individuals · Session 1', 'Junior Individuals · Session 2', 'Open', 'Finals · Junior Individuals', 'Lunch']);
    expect(sessions[0]).toMatchObject({
      competitionSectionId: 51, arenaName: 'Main arena', kind: 0, lanesPerHeat: 4, minutesPerHeat: 5, plannedRaces: ['Bending', 'Bottle'], scheduledStart: expect.any(String), durationMinutes: expect.any(Number),
    });
    expect(sessions[1].plannedRaces).toEqual([]);
    expect(sessions[2]).toMatchObject({ arenaName: 'Arena 2', minutesPerHeat: 10, lanesPerHeat: 6 });
    expect(sessions[3]).toMatchObject({ competitionSectionId: 51, name: 'Finals · Junior Individuals', arenaName: 'Main arena', kind: 0, lanesPerHeat: 4, minutesPerHeat: 5, plannedRaces: [] });
    expect(sessions[4]).toMatchObject({ competitionSectionId: null, kind: 1, isBreak: true, durationMinutes: 30, arenaName: null });
    expect(new Date(sessions[0].scheduledStart as string).getTime()).toBe(new Date('2026-10-24T09:00').getTime());
    expect(stored()).toBeNull();
    // The draft is gone and the steps are shown as done but cannot be opened.
    expect(step('Review')).toBeDisabled();
    expect(step('Timetable')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button', { name: 'Create competition' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.getByText('Competition page')).toBeInTheDocument();
  });

  it('opens the timetable tools when asked for an example timetable', async () => {
    seed('review');
    mount();
    await userEvent.click(createButton());
    await userEvent.click(await screen.findByRole('button', { name: 'Make one now' }));
    expect(screen.getByText('Timetable page')).toBeInTheDocument();
  });

  it('sets the lane order of a session after it is made, only when it is not the usual one', async () => {
    seed('review', {
      sections: [{ ...defaultSection(), laneRotation: 2 }, { ...defaultSection(), ageGroup: 'Open', laneRotation: 0 }, { ...defaultSection(), ageGroup: 'Juniors' }],
    });
    vi.mocked(api.post).mockImplementation(async (url, body) => ({
      data: url === '/competitions' ? { id: 41 } : url.endsWith('/sections') ? { id: 51 } : url.endsWith('/sessions') ? { id: 60 + (body as { orderIndex: number }).orderIndex } : {},
    }));
    mount();
    await userEvent.click(createButton());
    await screen.findByRole('heading', { level: 2, name: 'Competition created' });
    const settings = vi.mocked(api.put).mock.calls.filter(([url]) => String(url).endsWith('/settings') && String(url).includes('/sessions/'));
    expect(settings).toHaveLength(1);
    expect(settings[0][1]).toEqual({ laneRotationMode: 2 });
  });

  it('goes back to the step with the problem when something earlier is wrong', async () => {
    seed('review', { name: '  ' });
    mount();
    await userEvent.click(createButton());
    expect(h2('About')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('checks the breaks on the review step before creating', async () => {
    seed('review', { breaks: [{ kind: 1, name: '', date: '2026-10-24', time: '12:00', minutes: '', arena: '' }] });
    mount();
    await userEvent.click(createButton());
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText('Please fix the highlighted fields.')).toBeInTheDocument();
  });

  it('shows what went wrong, keeps the draft, and points to the competition if it was created', async () => {
    seed('review');
    vi.mocked(api.post).mockImplementation(async (url) => {
      if (url === '/competitions') return { data: { id: 41 } };
      throw { response: { data: { message: 'Section is not valid.' } } };
    });
    mount();
    await userEvent.click(createButton());
    const alert = await screen.findByText(/Adding Seniors failed: Section is not valid\./);
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

  it('saves on every change, with the step, and shows the time it was saved, with no Save button', async () => {
    seed('about', { name: '' });
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring');
    expect(stored()).toMatchObject({ name: 'Spring', step: 1 });
    expect(await screen.findByText(/Draft saved \d\d:\d\d/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save draft/ })).not.toBeInTheDocument();
    await next();
    expect(stored().step).toBe(2);
  });

  it('comes back after a reload at the same step, with the steps already reached open', () => {
    seed('sections', { savedAt: '2026-10-24T10:15:00' });
    mount();
    expect(h2('Sections')).toBeInTheDocument();
    expect(screen.getByText(/Draft saved 10:15/)).toBeInTheDocument();
    expect(step('When and where')).toBeEnabled();
    expect(step('Structure and timing')).toBeDisabled();
  });

  it('can be discarded after asking', async () => {
    seed('about', { savedAt: '2026-10-24T10:15:00' });
    mount();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true });
    autoConfirm([false, true]);
    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(stored()).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
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
    expect(h2('Start')).toBeInTheDocument();
    next();
    return waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Old draft'));
  });

  it('ignores a draft it cannot read, and copes with storage being blocked', async () => {
    localStorage.setItem(draftKey, '{nope');
    mount();
    await next();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    expect(screen.getByLabelText('Name')).toHaveValue('x');
    set.mockRestore();
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

  it('opens the same wizard on the details, without Start, and lets you jump to any step', async () => {
    mount('/admin/competitions/7');
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit competition' })).toBeInTheDocument();
    expect(h2('About')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 9')).toBeInTheDocument();
    expect(nav().queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument();
    expect(nav().queryByRole('button', { name: 'Timetable' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Autumn Area');
    expect(screen.getByLabelText('Organiser')).toHaveValue('Cheshire PC');
    expect(row('Icon')).toHaveAccessibleName('Icon: Trophy');
    for (const name of ['Review', 'Structure and timing', 'Races']) expect(step(name)).toBeEnabled();
    await userEvent.click(step('Payment and rules'));
    expect(screen.getByLabelText(/^How riders pay for now/)).toHaveValue('Bank 12-34');
    expect(screen.getByLabelText(/^Notes for riders/)).toHaveValue('Notes');
    expect(screen.getByText(/The passport and vaccination check is on the event details page/)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Passport and vaccination check' })).not.toBeInTheDocument();
    await userEvent.click(step('When and where'));
    expect(screen.getByLabelText('Venue')).toHaveValue('Tatton');
    expect(row('Starts')).toHaveAccessibleName(expect.stringContaining('24 Oct'));
    expect(row('Starts')).toHaveAccessibleName(expect.stringContaining('08:30'));
    expect(row('Ends')).toHaveAccessibleName(expect.stringContaining('16:00'));
    await userEvent.click(step('Sections'));
    const first = screen.getByRole('group', { name: 'Under 12' });
    expect(within(first).getByRole('spinbutton', { name: 'Price in pounds, Under 12' })).toHaveValue(45);
    expect(within(first).getByRole('spinbutton', { name: 'Max entries, Under 12' })).toHaveValue(12);
    expect(row('Type', within(first))).toBeDisabled();
    expect(row('Age group', within(first))).toBeDisabled();
    expect(within(first).getByRole('button', { name: 'Remove Under 12' })).toBeDisabled();
    expect(first).toHaveTextContent('It has entries, so it can’t be removed.');
    expect(within(screen.getByRole('group', { name: 'Open Pairs' })).getByRole('button', { name: 'Remove Open Pairs' })).toBeEnabled();
  });

  it('shows a session that already has heats as fixed, but still lets minutes change', async () => {
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Structure and timing'));
    const group = screen.getByRole('group', { name: 'Structure for Under 12' });
    expect(group).toHaveTextContent('structure is fixed');
    expect(row('Format', within(group))).toBeDisabled();
    expect(within(group).getByRole('button', { name: 'More: Sessions, Under 12' })).toBeDisabled();
    expect(within(group).getByRole('spinbutton', { name: 'Minutes per heat, Under 12' })).toHaveValue(8);
    expect(within(group).getByRole('button', { name: 'More: Minutes per heat, Under 12' })).toBeEnabled();
    expect(row('Lane after each race', within(group))).toBeDisabled();
    expect(group).toHaveTextContent('1 teams entered');
    await userEvent.click(step('Races'));
    expect(screen.getByText('Heats are made. Change the races on the On the day page.')).toBeInTheDocument();
    const open = screen.getByRole('region', { name: 'Open Pairs' });
    expect(within(open).getByText('Bottle')).toBeInTheDocument();
  });

  it('saves the details, the age groups and the sessions, and keeps breaks, without touching heats or teams', async () => {
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Sections'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Price in pounds, Under 12' }), { target: { value: '50' } });
    await userEvent.click(step('Review'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Competition page')).toBeInTheDocument());

    expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ name: 'Autumn Area', isActive: true, isArchived: false, organiserName: 'Cheshire PC' }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sections/21', expect.objectContaining({ priceMinor: 5000, maxParticipants: 12, finalistCount: 6, runoffRaceName: '2 Flag' }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sections/22', expect.objectContaining({ maxParticipants: 0 }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sections/21', expect.objectContaining({ hasFinal: true, carryPointsIntoFinal: false, doublePointsInFinal: false }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Competition page')).toBeInTheDocument());
    expect(vi.mocked(api.put).mock.calls.some(([url]) => String(url).includes('/sessions/'))).toBe(false);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('keeps the tie-break and lane order that were saved, and sends a change to the lane order of a session that has not started', async () => {
    const withRules = competition({
      ...saved, sections: [{ ...saved.sections[1], tieBreakRule: 3 }],
      sessions: [session(32, { competitionSectionId: 22, name: 'Open Pairs', orderIndex: 2, arenaName: 'Main arena', plannedRaces: ['Bending'], laneRotationMode: 1 })],
    });
    vi.mocked(api.get).mockImplementation(async (url) => (url === '/competitions/7' ? { data: withRules } : url === '/race-templates' ? { data: [] } : { data: {} }) as never);
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Structure and timing'));
    expect(row('Tie-break')).toHaveAccessibleName('Tie-break: Decide on the day');
    expect(row('Lane after each race')).toHaveAccessibleName('Lane after each race: Stay in lane');
    await userEvent.click(step('Review'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Competition page')).toBeInTheDocument());
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sections/22', expect.objectContaining({ tieBreakRule: 3 }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sessions/32/settings', { laneRotationMode: 1 });
  });

  it('adds new sessions, removes ones taken off, and removes a section and a break that were taken out', async () => {
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Sections'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Open Pairs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a section' }));
    await userEvent.click(step('Review'));
    await userEvent.click(screen.getByLabelText('Remove Lunch'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Competition page')).toBeInTheDocument());
    expect(api.delete).toHaveBeenCalledWith('/competitions/7/sections/22');
    expect(api.delete).toHaveBeenCalledWith('/competitions/7/sessions/33');
    expect(api.post).toHaveBeenCalledWith('/competitions/7/sections', expect.objectContaining({ ageGroup: 'Under 8', displayName: 'Under 8' }));
    const added = vi.mocked(api.post).mock.calls.find(([url]) => url === '/competitions/7/sessions')?.[1] as Record<string, unknown>;
    expect(added).toMatchObject({ competitionSectionId: 51, name: 'Under 8', orderIndex: expect.any(Number) });
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
    await userEvent.click(step('Structure and timing'));
    await userEvent.click(screen.getByRole('button', { name: 'Less: Sessions, Open Pairs' }));
    await userEvent.click(step('Review'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
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
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    unmount();
    localStorage.clear();
    signIn(['Trainer'], 'u1');
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Review'));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('says where entry fees are paid out, from the event itself', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/7') return { data: { ...saved, payoutsTo: { clubName: 'Cheshire PC', maskedAccount: '\u2022\u2022\u2022\u20221234', ready: true } } };
      if (url === '/race-templates') return { data: [] };
      return { data: {} };
    });
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Payment and rules'));
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
    await userEvent.click(step('Payment and rules'));
    expect(await screen.findByText(/Cheshire PC hasn't finished setting up payouts yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up payouts' })).toHaveAttribute('href', '/me/payouts');
  });

  it('keeps a local draft instead of reloading from the server', async () => {
    seed('about', { name: 'My unsaved edit' }, 'competitionEditor:edit:7');
    mount('/admin/competitions/7');
    expect(await screen.findByDisplayValue('My unsaved edit')).toBeInTheDocument();
  });

  it('opens a draft saved at Start on About', async () => {
    seed('start', { name: 'Unsaved' }, 'competitionEditor:edit:7');
    mount('/admin/competitions/7');
    expect(await screen.findByDisplayValue('Unsaved')).toBeInTheDocument();
    expect(h2('About')).toBeInTheDocument();
  });

  it('shows an age group that is not in the usual list', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => (url === '/competitions/7'
      ? { data: competition({ ...saved, sections: [{ ...saved.sections[0], ageGroup: 'Veterans', displayName: 'Veteran Teams' }], sessions: [] }) }
      : { data: [] }) as never);
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(step('Sections'));
    expect(row('Age group')).toBeDisabled();
    expect(row('Age group')).toHaveAccessibleName('Age group: Veterans');
  });
});
