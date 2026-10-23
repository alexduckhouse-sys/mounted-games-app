import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import PrintEventPage from './PrintEventPage';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const get = vi.mocked(api.get);
const COMPETITION = { id: 12, name: 'Spring Games', location: 'Tatton Park', startDate: '2031-05-04T09:00:00Z', endDate: null, createdByUserId: 'owner' };

function renderPoster() {
  return render(
    <MemoryRouter initialEntries={['/event-tools/12/print/poster']}>
      <Routes><Route path="/event-tools/:competitionId/print/:view" element={<PrintEventPage />} /></Routes>
    </MemoryRouter>,
  );
}

function allowOrganiser(allowed: boolean) {
  vi.mocked(useAuth).mockReturnValue({ canOrganise: () => allowed } as unknown as ReturnType<typeof useAuth>);
}

beforeEach(() => {
  allowOrganiser(true);
  get.mockResolvedValue({ data: COMPETITION });
});

describe('venue poster', () => {
  it('shows the name, date, venue and a QR code to the public event page, from public data only', async () => {
    renderPoster();
    expect(await screen.findByRole('heading', { name: 'Spring Games' })).toBeInTheDocument();
    expect(screen.getByText('Sun 4 May 2031')).toBeInTheDocument();
    expect(screen.getByText('Tatton Park')).toBeInTheDocument();
    expect(screen.getByText('Scan to see the timetable, live scores and results')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'QR code that opens Spring Games on Mounted Games' })).toBeInTheDocument();
    expect(screen.getByText(`${window.location.host}/competitions/12`)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/competitions/12');
  });

  it('leaves out the venue line when there is no venue, and prints on request', async () => {
    get.mockResolvedValue({ data: { ...COMPETITION, location: null } });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderPoster();
    await screen.findByRole('heading', { name: 'Spring Games' });
    expect(screen.queryByText('Tatton Park')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Print/ }));
    expect(print).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Event details/ })).toHaveAttribute('href', '/competitions/12/details');
  });

  it('turns away people who do not organise this event', async () => {
    allowOrganiser(false);
    renderPoster();
    expect(await screen.findByText('The venue poster is for this event’s organisers.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('offers another try when the event will not load', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    renderPoster();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load this event.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Spring Games' })).toBeInTheDocument();
  });
});
