import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { HorseboxEntranceCard } from '../competition/HorseboxEntranceCard';
import { EventDetailsPage } from './EventDetailsPage';

const reload = vi.fn();
const competition: Record<string, unknown> = {
  id: 7, name: 'Spring Open', organiserName: 'Oak Club', location: 'Stoneleigh Park', description: null, icon: 'trophy',
  startDate: '2031-05-04T09:00:00.000Z', endDate: null, isActive: true, isArchived: false, sections: [], teams: [], sessions: [], payoutsTo: null,
};
vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition, reload }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasRole: () => false }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const show = () => render(<MemoryRouter><EventDetailsPage /></MemoryRouter>);

describe('horsebox entrance on the organiser’s event details', () => {
  beforeEach(() => {
    for (const key of ['lorryWhat3Words', 'lorryLatitude', 'lorryLongitude', 'lorryDirectionsNote']) delete competition[key];
    vi.mocked(api.get).mockImplementation(async (url) => (String(url).endsWith('/passport-check')
      ? { data: { enabled: false, checked: 0, total: 0, sections: [] } }
      : String(url).endsWith('/dec-form-config') ? { data: { config: { useRefereeCards: false } } }
      : { data: { competitionId: 7, sections: [] } }) as never);
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('saves the what3words address without slashes and drops an old pin', async () => {
    const user = userEvent.setup();
    show();
    await user.type(await screen.findByLabelText(/what3words for the horsebox gate/), '///filled.count.soap');
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ lorryWhat3Words: 'filled.count.soap', lorryLatitude: null, lorryLongitude: null })));
    expect(await screen.findByText('Horsebox gate saved')).toBeInTheDocument();
  });

  it('refuses words that are not a what3words address', async () => {
    const user = userEvent.setup();
    show();
    await user.type(await screen.findByLabelText(/what3words for the horsebox gate/), 'second gate');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('three words with dots between');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('saves a pin, refuses a bad one and will not clear one on its own', async () => {
    const user = userEvent.setup();
    show();
    const pin = await screen.findByLabelText(/Pin for the gate/);
    await user.type(pin, 'north');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('latitude, longitude');
    await user.clear(pin);
    await user.type(pin, '52.1234, -1.5678');
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ lorryLatitude: 52.1234, lorryLongitude: -1.5678 })));
  });

  it('saves the directions note', async () => {
    const user = userEvent.setup();
    show();
    await user.type(await screen.findByLabelText(/Directions for lorries/), 'Second gate on the left');
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ lorryDirectionsNote: 'Second gate on the left' })));
  });

  it('removes the whole entrance after asking', async () => {
    Object.assign(competition, { lorryWhat3Words: 'filled.count.soap', lorryLatitude: 52.1, lorryLongitude: -1.5, lorryDirectionsNote: 'Second gate' });
    const asked = autoConfirm([false, true]);
    const user = userEvent.setup();
    show();
    expect(await screen.findByLabelText(/Pin for the gate/)).toHaveValue('52.1, -1.5');
    expect(screen.getByLabelText(/what3words for the horsebox gate/)).toHaveValue('///filled.count.soap');
    const button = screen.getByRole('button', { name: 'Remove the horsebox entrance' });
    await user.click(button);
    expect(api.put).not.toHaveBeenCalled();
    await user.click(button);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/7', expect.objectContaining({ lorryWhat3Words: '', lorryLatitude: null, lorryLongitude: null, lorryDirectionsNote: '' })));
    expect(asked.titles[0]).toBe('Remove the horsebox entrance?');
  });

  it('explains that a pin cannot be cleared by itself', async () => {
    Object.assign(competition, { lorryLatitude: 52.1, lorryLongitude: -1.5 });
    const user = userEvent.setup();
    show();
    await user.clear(await screen.findByLabelText(/Pin for the gate/));
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('remove the whole horsebox entrance');
  });
});

describe('HorseboxEntranceCard', () => {
  it('shows nothing when the organiser has not set one', () => {
    const { container } = render(<HorseboxEntranceCard competition={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the note and every map link', () => {
    render(<HorseboxEntranceCard competition={{ lorryWhat3Words: 'filled.count.soap', lorryLatitude: 52.1, lorryLongitude: -1.5, lorryDirectionsNote: 'Second gate on the left' }} />);
    expect(screen.getByRole('heading', { name: 'Horsebox entrance' })).toBeInTheDocument();
    expect(screen.getByText('Second gate on the left')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', expect.stringContaining('52.1,-1.5'));
    expect(screen.getByRole('link', { name: /Apple Maps/ })).toHaveAttribute('href', expect.stringContaining('maps.apple.com'));
    expect(screen.getByRole('link', { name: /Waze/ })).toHaveAttribute('href', 'https://waze.com/ul?ll=52.1,-1.5&navigate=yes');
    expect(screen.getByRole('link', { name: 'what3words ///filled.count.soap' })).toHaveAttribute('href', 'https://what3words.com/filled.count.soap');
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows just the note when there is no pin', () => {
    render(<HorseboxEntranceCard competition={{ lorryDirectionsNote: 'Follow the signs' }} />);
    expect(screen.getByText('Follow the signs')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
