import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import { competition } from '../../test/factories';
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
const publishButton = () => screen.getByRole('button', { name: 'Publish and open entries' });

beforeEach(() => {
  signIn(['Admin']);
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/auth/me') return { data: {} };
    if (url === '/competitions/access') return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(api.post).mockImplementation(async (url) => ({ data: url === '/competitions' ? { id: 41 } : {} }));
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  vi.mocked(api.delete).mockResolvedValue({ data: {} });
});

describe('CompetitionEditor: the one-page layout', () => {
  it('shows six numbered parts and no wizard steps, review or helper text', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'New competition' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'About the competition', 'When', 'Where', 'What people can enter', 'Payment and notes', 'Dec form',
    ]);
    expect(screen.queryByText(/Review|Next|Basics/)).not.toBeInTheDocument();
    expect(screen.queryByText(/auto-saved|Finalise|Teams in the final|Look up coordinates/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Apple Maps|Latitude/)).not.toBeInTheDocument();
  });

  it('has the fields from the design', () => {
    mount();
    for (const label of ['Name', 'Icon', 'Organiser', 'Starts', 'Start time', 'Ends', 'End time', 'Venue', 'Postcode', 'what3words (optional)',
      'How riders pay for now (optional)', 'Notes for riders (optional)']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Ends').parentElement).toHaveTextContent('Same day');
    expect(screen.getByLabelText('How riders pay for now (optional)')).toHaveAttribute('placeholder', 'Bank details or PayPal');
  });

  it('starts with one section row, with the table columns, and a row to add another', async () => {
    mount();
    const row = screen.getByRole('group', { name: 'Section 1' });
    expect(within(row).getByLabelText('Format')).toHaveValue('2');
    expect(within(row).getByLabelText('Age group')).toHaveValue('Seniors');
    expect(within(row).getByLabelText('Price')).toHaveValue(null);
    expect(within(row).getByLabelText('Max')).toHaveAttribute('placeholder', 'No cap');
    expect(within(row).getByRole('button', { name: 'Remove section 1' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Add a section' }));
    expect(screen.getByRole('group', { name: 'Section 2' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Section 1' })).getByRole('button', { name: 'Remove section 1' })).toBeEnabled();
  });

  it('removes a section', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Add a section' }));
    await userEvent.selectOptions(within(screen.getByRole('group', { name: 'Section 2' })).getByLabelText('Age group'), 'Open');
    await userEvent.click(screen.getByRole('button', { name: 'Remove section 1' }));
    const [only] = screen.getAllByRole('group', { name: /Section \d/ });
    expect(within(only).getByLabelText('Age group')).toHaveValue('Open');
  });

  it('shows the icon chosen', async () => {
    mount();
    expect(screen.getByTestId('competition-icon-preview')).toHaveTextContent('🏁');
    await userEvent.selectOptions(screen.getByLabelText('Icon'), 'Trophy');
    expect(screen.getByTestId('competition-icon-preview')).toHaveTextContent('🏆');
  });
});

describe('CompetitionEditor: validation', () => {
  it('shows each problem under its field, takes focus to the first, and sends nothing', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '' } });
    await userEvent.click(publishButton());
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter a name.');
    expect(screen.getByLabelText('Starts')).toHaveAccessibleDescription('Choose a start date.');
    expect(screen.getByLabelText('Start time')).toHaveAccessibleDescription('Choose a start time.');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByLabelText('Name').parentElement).toHaveAttribute('data-invalid', 'true');
    expect(api.post).not.toHaveBeenCalled();
    // The message goes as soon as the field is put right.
    await userEvent.type(screen.getByLabelText('Name'), 'Spring Games');
    expect(screen.getByLabelText('Name')).not.toHaveAccessibleDescription('Enter a name.');
    expect(screen.getByLabelText('Name').parentElement).toHaveAttribute('data-invalid', 'false');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-24' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '08:30' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('needs an age group on every section', async () => {
    localStorage.setItem(draftKey, JSON.stringify({
      name: 'Spring Games', startDate: '2026-10-24', startTime: '09:00', endDate: '', endTime: '17:00', location: '', icon: 'flag',
      what3Words: '', postcode: '', appleMapsUrl: '', lat: '', lon: '', description: '', teams: [],
      sections: [{ format: 2, ageGroup: '', sessions: [{ name: 'x', races: '', scope: 'Zone' }], minsPerHeat: 25, maxTeamsPerHeat: 6, runoffRaceName: '2 Flag', usesRaceFinals: false, priceGbp: '' }],
    }));
    mount();
    await userEvent.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an age group.');
    expect(screen.getByLabelText('Age group')).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText('Age group'), 'Open');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('CompetitionEditor: publishing', () => {
  it('creates the competition and its sections only, then opens it', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Name'), '  Cheshire Area Mounted Games ');
    await userEvent.type(screen.getByLabelText('Organiser'), 'Cheshire Area Pony Club');
    await userEvent.type(screen.getByLabelText('Venue'), 'Tatton Park, Knutsford');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-24' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '08:30' } });
    await userEvent.type(screen.getByLabelText('How riders pay for now (optional)'), 'PayPal: pay@example.com');
    await userEvent.type(screen.getByLabelText('Notes for riders (optional)'), 'Bring a hat');
    const row = screen.getByRole('group', { name: 'Section 1' });
    await userEvent.selectOptions(within(row).getByLabelText('Format'), 'Pairs');
    await userEvent.selectOptions(within(row).getByLabelText('Age group'), 'Under 12');
    await userEvent.type(within(row).getByLabelText('Price'), '45');
    await userEvent.type(within(row).getByLabelText('Max'), '12');
    await userEvent.click(publishButton());

    expect(await screen.findByText('Competition page')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
    const [path, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/competitions');
    expect(body).toMatchObject({
      name: 'Cheshire Area Mounted Games', icon: 'flag', location: 'Tatton Park, Knutsford', organiserName: 'Cheshire Area Pony Club',
      paymentDestination: 'PayPal: pay@example.com', description: 'Bring a hat', latitude: null, longitude: null,
      startDate: new Date('2026-10-24T08:30').toISOString(), endDate: new Date('2026-10-24T17:00').toISOString(),
    });
    expect(vi.mocked(api.post).mock.calls[1]).toEqual(['/competitions/41/sections', {
      format: 1, ageGroup: 'Under 12', displayName: 'Pairs Under 12', runoffRaceName: null, usesRaceFinals: false,
      priceMinor: 4500, maxParticipants: 12, finalistCount: null,
    }]);
    expect(localStorage.getItem(draftKey)).toBeNull();
  });

  it('shows a server problem beside the buttons and keeps the draft', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'Name already used.' } } });
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring Games');
    await userEvent.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Name already used.');
    expect(stored().name).toBe('Spring Games');
    expect(publishButton()).toBeEnabled();
  });

  it('falls back to a plain message when the server says nothing useful', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('boom'));
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring Games');
    await userEvent.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create competition.');
  });

  it('is view only for someone who cannot organise', () => {
    signIn(['Member']);
    mount();
    expect(publishButton()).toBeDisabled();
    expect(screen.getByText('Only admins and trainers can save changes.')).toBeInTheDocument();
  });
});

describe('CompetitionEditor: the draft', () => {
  it('shows nothing about a draft on a fresh page', () => {
    mount();
    expect(screen.queryByText(/Draft saved/)).not.toBeInTheDocument();
  });

  it('saves on every change and shows the time it was saved', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring');
    expect(stored().name).toBe('Spring');
    expect(await screen.findByText(/Draft saved \d\d:\d\d/)).toBeInTheDocument();
    expect(stored().savedAt).toBeTruthy();
  });

  it('saves when Save draft is pressed and keeps the page', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText(/Draft saved \d\d:\d\d/)).toBeInTheDocument();
    expect(stored()).toMatchObject({ name: '' });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('comes back after a reload, with the time it was saved, and ignores an old wizard step', () => {
    localStorage.setItem(draftKey, JSON.stringify({
      step: 'Review', name: 'Half done', location: 'Here', icon: 'trophy', startDate: '2026-10-24', startTime: '10:00', endDate: '', endTime: '17:00',
      what3Words: '', postcode: 'WA16 6QN', appleMapsUrl: '', lat: '', lon: '', description: '', teams: [], savedAt: '2026-10-22T11:42:00',
      sections: [{ format: 3, ageGroup: 'Open', sessions: [{ name: 'x', races: '', scope: 'Zone' }], minsPerHeat: 25, maxTeamsPerHeat: 6, runoffRaceName: '2 Flag', usesRaceFinals: false, priceGbp: '12', maxParticipants: '' }],
    }));
    mount();
    expect(screen.getByLabelText('Name')).toHaveValue('Half done');
    expect(screen.getByLabelText('Postcode')).toHaveValue('WA16 6QN');
    expect(screen.getByLabelText('Format')).toHaveValue('3');
    expect(screen.getByLabelText('Price')).toHaveValue(12);
    expect(screen.getByText('Draft saved 11:42')).toBeInTheDocument();
    expect(stored().savedAt).toBe('2026-10-22T11:42:00');
  });

  it('can be discarded after asking', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    await userEvent.click(await screen.findByRole('button', { name: 'Discard draft' }));
    expect(reload).not.toHaveBeenCalled();
    expect(stored()).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('copes with storage being blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Spring Games');
    await userEvent.click(publishButton());
    expect(await screen.findByText('Competition page')).toBeInTheDocument();
  });
});

describe('CompetitionEditor: where', () => {
  const geocodeWith = (impl: () => Promise<unknown>) => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/geocode') return impl();
      if (url === '/auth/me') return { data: {} };
      if (url === '/competitions/access') return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
  };

  it('looks the location up when the postcode loses focus, then shows a tick and sends the coordinates', async () => {
    geocodeWith(async () => ({ data: { latitude: 53.33, longitude: -2.38, source: 'postcodes' } }));
    mount();
    await userEvent.type(screen.getByLabelText('Postcode'), 'wa16 6qn');
    expect(screen.queryByRole('img', { name: 'Location found' })).not.toBeInTheDocument();
    await userEvent.tab();
    expect(await screen.findByRole('img', { name: 'Location found' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/geocode', { params: { postcode: 'wa16 6qn', w3w: undefined } });
    await userEvent.type(screen.getByLabelText('Name'), 'Spring Games');
    await userEvent.click(publishButton());
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ latitude: 53.33, longitude: -2.38, postcode: 'wa16 6qn' });
  });

  it('looks up a what3words address too, and does not look up the same thing twice', async () => {
    geocodeWith(async () => ({ data: { latitude: 1, longitude: 2, source: 'w3w' } }));
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
    mount();
    await userEvent.click(screen.getByLabelText('Postcode'));
    await userEvent.tab();
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/geocode')).toBe(false);
  });

  it('says so under the postcode when nothing is found, and drops the message when it changes', async () => {
    geocodeWith(async () => ({ data: { latitude: null, longitude: null, source: null } }));
    mount();
    await userEvent.type(screen.getByLabelText('Postcode'), 'ZZ1');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('No location found for that.');
    expect(screen.queryByRole('img', { name: 'Location found' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Postcode'), '2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when the lookup fails, and lets the person try again', async () => {
    geocodeWith(async () => { throw new Error('offline'); });
    mount();
    await userEvent.type(screen.getByLabelText('Postcode'), 'WA16');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not look that up.');
    geocodeWith(async () => ({ data: { latitude: 5, longitude: 6, source: 'x' } }));
    await userEvent.click(screen.getByLabelText('Postcode'));
    await userEvent.tab();
    expect(await screen.findByRole('img', { name: 'Location found' })).toBeInTheDocument();
  });
});

describe('CompetitionEditor: ends', () => {
  it('shows "Same day" until an end date is chosen', () => {
    mount();
    const ends = screen.getByLabelText('Ends');
    expect(ends.parentElement).toHaveTextContent('Same day');
    fireEvent.change(ends, { target: { value: '2026-10-25' } });
    expect(ends.parentElement).not.toHaveTextContent('Same day');
  });

  it('sends the chosen end date, or the start date when there is none', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Name'), 'Two days');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-10-24' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-25' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '16:00' } });
    await userEvent.click(publishButton());
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ endDate: new Date('2026-10-25T16:00').toISOString() });
  });
});

describe('CompetitionEditor: editing', () => {
  const saved = competition({
    id: 7, name: 'Autumn Area', icon: 'trophy', location: 'Tatton', description: 'Notes', organiserName: 'Cheshire PC', paymentDestination: 'Bank 12-34',
    createdByUserId: 'u1', what3Words: 'a.b.c', appleMapsUrl: 'https://maps.apple.com/?ll=1,2', latitude: 53.1, longitude: -2.2,
    startDate: '2026-10-24T08:30:00', endDate: '2026-10-25T16:00:00',
    sections: [{ id: 21, competitionId: 7, format: 2, ageGroup: 'Under 12', displayName: 'Under 12', priceMinor: 4500, maxParticipants: 12, finalistCount: 6, runoffRaceName: '2 Flag', usesRaceFinals: false }],
  });

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/7') return { data: saved };
      if (url === '/auth/me') return { data: {} };
      if (url === '/competitions/access') return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  it('says where entry fees are paid out, from the event itself', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/7') return { data: { ...saved, payoutsTo: { clubName: 'Cheshire PC', maskedAccount: '\u2022\u2022\u2022\u20221234', ready: true } } };
      if (url === '/auth/me') return { data: {} };
      if (url === '/competitions/access') return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
    mount('/admin/competitions/7');
    expect(await screen.findByText('Entry fees are paid out to Cheshire PC \u2014 \u2022\u2022\u2022\u20221234 \u00b7 Ready')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Set up payouts' })).not.toBeInTheDocument();
    expect(screen.getByText('Test mode: no real money moves yet.')).toBeInTheDocument();
  });

  it('links an admin to Set up payouts when the club is not ready', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/7') return { data: { ...saved, payoutsTo: { clubName: 'Cheshire PC', maskedAccount: null, ready: false } } };
      if (url === '/auth/me') return { data: {} };
      if (url === '/competitions/access') return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
    mount('/admin/competitions/7');
    expect(await screen.findByText(/Cheshire PC hasn't finished setting up payouts yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up payouts' })).toHaveAttribute('href', '/me/payouts');
  });

  it('asks a trainer to get their manager to set payouts up, using the club summary for a new event', async () => {
    signIn(['Trainer']);
    const auth = JSON.parse(localStorage.getItem('mg.auth')!);
    auth.user.clubId = 5;
    localStorage.setItem('mg.auth', JSON.stringify(auth));
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/clubs/5/payouts/summary') return { data: { clubName: 'Cheshire PC', maskedAccount: null, ready: false } };
      if (url === '/auth/me') return { data: {} };
      if (url === '/competitions/access') return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
    mount();
    expect(await screen.findByText(/Cheshire PC hasn't finished setting up payouts yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Set up payouts' })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask your club.s manager/)).toBeInTheDocument();
  });

  it('loads the competition into the same page', async () => {
    mount('/admin/competitions/7');
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit competition' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Autumn Area');
    expect(screen.getByLabelText('Organiser')).toHaveValue('Cheshire PC');
    expect(screen.getByLabelText('How riders pay for now (optional)')).toHaveValue('Bank 12-34');
    expect(screen.getByLabelText('Notes for riders (optional)')).toHaveValue('Notes');
    expect(screen.getByLabelText('Venue')).toHaveValue('Tatton');
    expect(screen.getByLabelText('Price')).toHaveValue(45);
    expect(screen.getByLabelText('Max')).toHaveValue(12);
    expect(screen.getByLabelText('Format')).toBeDisabled();
    expect(screen.getByLabelText('Age group')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Publish and open entries' })).not.toBeInTheDocument();
  });

  it('saves changes to the competition and its sections, keeping what has no field on the page', async () => {
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.clear(screen.getByLabelText('Price'));
    await userEvent.type(screen.getByLabelText('Price'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Add a section' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Competition page')).toBeInTheDocument();
    expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({
      name: 'Autumn Area', organiserName: 'Cheshire PC', paymentDestination: 'Bank 12-34', what3Words: 'a.b.c',
      appleMapsUrl: 'https://maps.apple.com/?ll=1,2', latitude: 53.1, longitude: -2.2, isActive: true, isArchived: false,
    }));
    expect(api.put).toHaveBeenCalledWith('/competitions/7/sections/21', {
      runoffRaceName: '2 Flag', usesRaceFinals: false, priceMinor: 5000, maxParticipants: 12, finalistCount: 6,
    });
    expect(api.post).toHaveBeenCalledWith('/competitions/7/sections', expect.objectContaining({ format: 2, ageGroup: 'Seniors', priceMinor: 0, finalistCount: null }));
  });

  it('deletes a section that was taken off', async () => {
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(screen.getByRole('button', { name: 'Add a section' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove section 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Competition page');
    expect(api.delete).toHaveBeenCalledWith('/competitions/7/sections/21');
  });

  it('says so when the competition cannot be loaded', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/auth/me') return { data: {} };
      if (url === '/competitions/access') return { data: [] };
      throw new Error('missing');
    });
    mount('/admin/competitions/7');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load competition.');
  });

  it('reports a failed save', async () => {
    vi.mocked(api.put).mockRejectedValue({ response: { data: 'Locked.' } });
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Locked.');
  });

  it('stops a trainer who does not own the competition saving it', async () => {
    signIn(['Trainer'], 'someone-else');
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('Only admins and trainers can save changes.')).toBeInTheDocument();
  });

  it('lets the owning trainer save it', async () => {
    signIn(['Trainer'], 'u1');
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled());
  });

  it('keeps a local draft instead of reloading from the server', async () => {
    localStorage.setItem('competitionEditor:edit:7', JSON.stringify({
      name: 'My unsaved edit', location: '', icon: 'flag', startDate: '2026-10-24', startTime: '09:00', endDate: '', endTime: '17:00',
      what3Words: '', postcode: '', appleMapsUrl: '', lat: '', lon: '', description: '', teams: [],
      sections: [{ format: 2, ageGroup: 'Open', sessions: [{ name: 'x', races: '', scope: 'Zone' }], minsPerHeat: 25, maxTeamsPerHeat: 6, runoffRaceName: '2 Flag', usesRaceFinals: false, priceGbp: '' }],
    }));
    mount('/admin/competitions/7');
    expect(screen.getByLabelText('Name')).toHaveValue('My unsaved edit');
  });

  it('shows an age group that is not in the usual list', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/competitions/7') return { data: { ...saved, sections: [{ ...saved.sections[0], ageGroup: 'Veterans', displayName: 'Veterans' }] } };
      if (url === '/auth/me') return { data: {} };
      return { data: [] };
    });
    mount('/admin/competitions/7');
    await screen.findByDisplayValue('Autumn Area');
    expect(screen.getByLabelText('Age group')).toHaveValue('Veterans');
  });
});

describe('CompetitionEditor: legacy drafts', () => {
  it('migrates a draft that stored one race list per section', () => {
    localStorage.setItem(draftKey, JSON.stringify({
      name: 'Old draft', location: '', icon: 'flag', startDate: '2026-10-24', startTime: '09:00', endDate: '', endTime: '17:00',
      what3Words: '', postcode: '', appleMapsUrl: '', lat: '', lon: '', description: '', teams: [],
      sections: [{ format: 2, ageGroup: 'Juniors', sessionName: 'Juniors', races: 'Bending', scope: 'Area', sessionCount: 2, priceGbp: '' }],
    }));
    mount();
    expect(screen.getByLabelText('Name')).toHaveValue('Old draft');
    expect(screen.getByLabelText('Age group')).toHaveValue('Juniors');
  });

  it('ignores a draft it cannot read', () => {
    localStorage.setItem(draftKey, '{nope');
    mount();
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });
});
