import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { NearestEmergency } from '../../types';
import { NearestAe } from './NearestAe';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const hospital = { name: 'County General Hospital', address: '1 High Street, Townsville', postcode: 'CV2 2DX', phone: '01234 567890', latitude: 52.12, longitude: -1.12, distanceMiles: 4.3 };
const answer = (extra: Partial<NearestEmergency> = {}): { data: NearestEmergency } => ({ data: { available: true, hospital, ...extra } });
const reminder = 'Check your nearest A&E before the day.';

describe('NearestAe in the poster’s emergency box', () => {
  beforeEach(() => { vi.mocked(api.get).mockReset(); });

  it('asks our own API for the venue and shows the hospital with its small print and credit', async () => {
    vi.mocked(api.get).mockResolvedValue(answer());
    render(<NearestAe competitionId={12} />);

    expect(await screen.findByText('County General Hospital')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/competitions/12/nearest-emergency');
    expect(screen.getByText('Nearest A&E:')).toBeInTheDocument();
    expect(screen.getByText('CV2 2DX')).toBeInTheDocument();
    expect(screen.getByText('Tel 01234 567890')).toBeInTheDocument();
    expect(screen.getByText('about 4.3 miles away')).toBeInTheDocument();
    expect(screen.getByText(/From OpenStreetMap\. Check before the day\. In an emergency call 999\./)).toHaveTextContent('© OpenStreetMap contributors');
    expect(screen.queryByText(reminder)).not.toBeInTheDocument();
  });

  it('says "1 mile" for one mile and leaves out a missing postcode or phone', async () => {
    vi.mocked(api.get).mockResolvedValue(answer({ hospital: { ...hospital, postcode: null, phone: null, distanceMiles: 1 } }));
    render(<NearestAe competitionId="12" />);

    expect(await screen.findByText('about 1 mile away')).toBeInTheDocument();
    expect(screen.queryByText(/^Tel /)).not.toBeInTheDocument();
    expect(screen.queryByText('CV2 2DX')).not.toBeInTheDocument();
  });

  it('shows nothing at all while the answer is on its way', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
    const { container } = render(<NearestAe competitionId={12} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['the lookup was not available', answer({ available: false, hospital: null })],
    ['nothing was in range', answer({ hospital: null })],
    ['an older server sent something else', { data: '<!doctype html><html></html>' }],
    ['an empty body', { data: null }],
  ])('only shows the screen reminder when %s', async (_case, response) => {
    vi.mocked(api.get).mockResolvedValue(response);
    render(<NearestAe competitionId={12} />);

    const line = await screen.findByText(reminder);
    expect(line).toHaveClass('print:hidden');
    expect(screen.queryByText(/OpenStreetMap/)).not.toBeInTheDocument();
  });

  it('shows the reminder, not an error, when the request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<NearestAe competitionId={12} />);

    expect(await screen.findByText(reminder)).toBeInTheDocument();
  });

  it('ignores an answer that arrives after the page has gone', async () => {
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => { finish = resolve; }) as never);
    const { container, unmount } = render(<NearestAe competitionId={12} />);
    unmount();
    finish(answer());

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
