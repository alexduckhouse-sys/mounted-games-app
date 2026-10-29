import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { fetchEmergencyContacts } from './contactLookup';
import { EmergencySearch } from './EmergencySearch';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const entry = (over: Record<string, unknown> = {}) => ({
  riderEntryId: 1, riderName: 'Ava Test', ponyName: 'Biscuit', teamId: 4, teamName: 'Oak A', sectionId: 11, sectionName: 'Under 12', clubName: 'Hill Pony Club',
  bibColour: 'Red', isReserve: false, emergencyContactName: 'Pat Test', emergencyContactPhone: '07700 900123', trainerName: 'Sam Coach', trainerPhone: '+44 7700 900456',
  medicalNotes: 'Asthma', ...over,
});
const type = async (text: string) => {
  fireEvent.change(screen.getByLabelText('Find a rider'), { target: { value: text } });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
};

describe('EmergencySearch', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(api.get).mockResolvedValue({ data: [entry()] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('lists nobody until something is typed, and says searches are recorded', () => {
    render(<EmergencySearch competitionId={7} />);
    expect(screen.getByText(/Every search is recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Type at least 2 letters/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('does not search on a single letter', async () => {
    render(<EmergencySearch competitionId={7} />);
    await type('a');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('searches after typing and shows tap-to-call numbers', async () => {
    render(<EmergencySearch competitionId={7} />);
    await type('  Ava ');
    expect(api.get).toHaveBeenCalledWith('/competitions/7/emergency-contacts', { params: { q: 'Ava' } });
    expect(screen.getByText('Ava Test on Biscuit')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /07700 900123/ })).toHaveAttribute('href', 'tel:07700900123');
    fireEvent.click(screen.getByRole('button', { name: /Ava Test on Biscuit/ }));
    expect(screen.getByRole('link', { name: /\+44 7700 900456/ })).toHaveAttribute('href', 'tel:+447700900456');
    expect(screen.getByText('Medical notes: Asthma')).toBeInTheDocument();
  });

  it('copes with missing numbers and reserves', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [entry({ emergencyContactPhone: null, trainerName: null, trainerPhone: null, ponyName: null, isReserve: true, medicalNotes: null }), entry({ riderEntryId: 2, emergencyContactName: null, emergencyContactPhone: null })] });
    render(<EmergencySearch competitionId={7} />);
    await type('Ava');
    expect(screen.getAllByText(/Pat Test · no number/).length).toBeGreaterThan(0);
    expect(screen.getByText('Ava Test (reserve)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ava Test \(reserve\)/ }));
    expect(screen.queryByText('Coach')).not.toBeInTheDocument();
  });

  it('says when nobody matches', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    render(<EmergencySearch competitionId={7} />);
    await type('zzz');
    expect(screen.getByText(/Nobody matches that/)).toBeInTheDocument();
  });

  it('caps a long list and asks for more of the name', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: Array.from({ length: 40 }, (_, i) => entry({ riderEntryId: i, riderName: `Rider ${i}` })) });
    render(<EmergencySearch competitionId={7} />);
    await type('Rider');
    expect(screen.getAllByText(/^Rider \d+ on Biscuit$/)).toHaveLength(30);
    expect(screen.getByText(/first 30 of 40/)).toBeInTheDocument();
  });

  it('shows a plain error without echoing anything about the search', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<EmergencySearch competitionId={7} />);
    await type('Ava');
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t search');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Ava');
  });

  it('drops the results when the box is cleared', async () => {
    render(<EmergencySearch competitionId={7} />);
    await type('Ava');
    await type('');
    expect(screen.queryByText('Ava Test on Biscuit')).not.toBeInTheDocument();
  });

  it('rejects a reply that is not a list', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: '<html>' });
    await expect(fetchEmergencyContacts(7, 'Ava')).rejects.toThrow('Unexpected response');
  });
});
