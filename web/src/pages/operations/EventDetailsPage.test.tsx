import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { EventDetailsPage } from './EventDetailsPage';

const reload = vi.fn();
const competition = {
  id: 7, name: 'Spring Open', organiserName: 'Oak Club', location: 'Stoneleigh Park', description: null, icon: 'trophy',
  startDate: '2031-05-04T09:00:00.000Z', endDate: '2031-05-05T17:00:00.000Z', isActive: true, isArchived: false,
  sections: [], teams: [], sessions: [], payoutsTo: null,
};
vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition, reload }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'Admin' }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const sections = [
  { sectionId: 11, sectionName: 'Teams Under 12', configured: true, isEnabled: true, mode: 1, maxPoints: 10, sectors: [{ id: 1, name: 'Saddle' }, { id: 2, name: 'Bridle' }], teams: [] },
  { sectionId: 12, sectionName: 'Pairs Under 15', configured: false, isEnabled: false, mode: 0, maxPoints: 10, sectors: [{ id: 0, name: 'Saddle' }], teams: [] },
];

function show() {
  return render(<MemoryRouter><EventDetailsPage /></MemoryRouter>);
}

describe('EventDetailsPage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url) => (String(url).endsWith('/passport-check')
      ? { data: { enabled: false, checked: 0, total: 0, sections: [] } }
      : String(url).endsWith('/dec-form-config') ? { data: { config: { useRefereeCards: false } } }
      : { data: { competitionId: 7, sections } }) as never);
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('has no Save button and saves a text field when it loses focus, sending the other fields as they are', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('switch', { name: 'Passport and vaccination check' });
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();

    const organiser = screen.getByLabelText('Organiser');
    await user.clear(organiser);
    await user.type(organiser, 'Elm Club');
    expect(api.put).not.toHaveBeenCalled();
    await user.tab();

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ name: 'Spring Open', organiserName: 'Elm Club', location: 'Stoneleigh Park', startDate: competition.startDate })));
    expect(reload).toHaveBeenCalled();
    // A small toast confirms it, since there is no Save button.
    expect(await screen.findByText('Organiser saved')).toBeInTheDocument();
  });

  it('saves the postcode, competition number and contact email, and sends a blank to clear one', async () => {
    const user = userEvent.setup();
    Object.assign(competition, { postcode: 'GL19 3BE', competitionNumber: null, contactEmail: 'entries@example.org' });
    try {
      show();
      await screen.findByRole('switch', { name: 'Passport and vaccination check' });
      expect(screen.getByLabelText('Postcode')).toHaveValue('GL19 3BE');
      expect(screen.getByLabelText('Contact email')).toHaveValue('entries@example.org');
      expect(screen.getByText('The contact email shows on the event page, so entrants can write to you.')).toBeInTheDocument();

      await user.type(screen.getByLabelText('Competition number'), ' 2026-041 ');
      await user.tab();
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ competitionNumber: '2026-041' })));
      expect(await screen.findByText('Competition number saved')).toBeInTheDocument();

      // The API leaves a value alone on null and clears it on blank, so clearing sends an empty string.
      await user.clear(screen.getByLabelText('Contact email'));
      await user.tab();
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ contactEmail: '' })));
      await user.clear(screen.getByLabelText('Postcode'));
      await user.type(screen.getByLabelText('Postcode'), 'sw1a 1aa');
      await user.tab();
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ postcode: 'sw1a 1aa' })));
    } finally {
      for (const key of ['postcode', 'competitionNumber', 'contactEmail']) delete (competition as Record<string, unknown>)[key];
    }
  });

  it('shows the API’s reason when the contact email is refused', async () => {
    vi.mocked(api.put).mockRejectedValueOnce({ response: { data: { message: 'That contact email doesn’t look right. Check it, or leave it blank.' } } });
    const user = userEvent.setup();
    show();
    await screen.findByRole('switch', { name: 'Passport and vaccination check' });
    await user.type(screen.getByLabelText('Contact email'), 'nope');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('That contact email doesn’t look right.');
  });

  it('does not save an unchanged field, and refuses an empty name', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('switch', { name: 'Passport and vaccination check' });
    await user.click(screen.getByLabelText('Venue'));
    await user.tab();
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.tab();
    expect(api.put).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Name can’t be empty.');
  });

  it('shows why a save failed', async () => {
    vi.mocked(api.put).mockRejectedValueOnce({ response: { data: { message: 'Not allowed.' } } });
    const user = userEvent.setup();
    show();
    await screen.findByRole('switch', { name: 'Passport and vaccination check' });
    await user.type(screen.getByLabelText('Venue'), ' North');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.');
    expect(screen.queryByText('Venue saved')).toBeNull();
  });

  it('turns the passport check on at once, and puts the switch back if it fails', async () => {
    const user = userEvent.setup();
    show();
    const toggle = await screen.findByRole('switch', { name: 'Passport and vaccination check' });
    await user.click(toggle);
    expect(api.put).toHaveBeenCalledWith('/event-tools/competitions/7/passport-check/settings', { enabled: true });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the passport check');
  });

  it('saves the yellow and red cards switch at once through the competition update, and reverts on failure', async () => {
    const user = userEvent.setup();
    show();
    const toggle = await screen.findByRole('switch', { name: 'Yellow and red cards' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ useRefereeCards: true, name: 'Spring Open' })));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the cards setting');
  });

  it('saves a tack check choice at once', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('switch', { name: 'Passport and vaccination check' });
    expect(screen.getByRole('button', { name: 'Tack check · Teams Under 12: Own table' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tack check · Pairs Under 15: Off' })).toBeInTheDocument();
    expect(screen.getByText('2 sectors · 20 points')).toBeInTheDocument();

    vi.mocked(api.put).mockResolvedValueOnce({ data: { ...sections[1], isEnabled: true, mode: 2 } });
    await user.click(screen.getByRole('button', { name: 'Tack check · Pairs Under 15: Off' }));
    expect(screen.getByRole('option', { name: 'Off' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'Adds to points' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/event-tools/competitions/7/tack-check/sections/12',
      { isEnabled: true, mode: 2, maxPoints: 10, sectors: [{ id: null, name: 'Saddle' }] },
    ));
    expect(await screen.findAllByText(/Scoring table/)).toHaveLength(2);
  });

  it('opens the choice as a small list under the row', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Tack check · Pairs Under 15: Off' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Tack check · Pairs Under 15' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('edits the scoring table: blank new sector, dropped when left empty, saved on Done', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('switch', { name: 'Passport and vaccination check' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Sector 1 name')).toHaveValue('Saddle');

    await user.click(screen.getByRole('button', { name: 'Add a sector' }));
    const blank = screen.getByLabelText('Sector 3 name');
    expect(blank).toHaveValue('');
    await user.tab();
    await user.click(document.body);
    expect(screen.queryByLabelText('Sector 3 name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove sector 2' }));
    await user.click(screen.getByRole('button', { name: 'Add a sector' }));
    await user.type(screen.getByLabelText('Sector 2 name'), 'Boots');
    vi.mocked(api.put).mockResolvedValueOnce({ data: { ...sections[0], sectors: [{ id: 1, name: 'Saddle' }, { id: 5, name: 'Boots' }] } });
    await user.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/event-tools/competitions/7/tack-check/sections/11',
      { isEnabled: true, mode: 1, maxPoints: 10, sectors: [{ id: 1, name: 'Saddle' }, { id: null, name: 'Boots' }] },
    ));
    await waitFor(() => expect(screen.queryByLabelText('Sector 1 name')).not.toBeInTheDocument());
  });

  it('keeps the table open and says what is wrong when the sectors cannot be saved', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('switch', { name: 'Passport and vaccination check' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Remove sector 1' }));
    await user.click(screen.getByRole('button', { name: 'Remove sector 1' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add between 1 and');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('duplicates the set-up for next year', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { competitionId: 9, name: 'Spring Open copy' } });
    const user = userEvent.setup();
    show();
    await screen.findByRole('switch', { name: 'Passport and vaccination check' });
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/event-tools/competitions/7/clone', expect.objectContaining({ name: 'Spring Open copy' })));
    expect(await screen.findByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/competitions/9');
  });
});
