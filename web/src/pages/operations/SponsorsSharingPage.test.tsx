import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { dateToEnd, dateToStart } from '../../lib/sponsors';
import { autoConfirm } from '../../test/confirm';
import { liteWrapper } from '../../test/lite';
import { prepareLogo } from '../competition/sponsorLogo';
import { SponsorsSharingPage } from './SponsorsSharingPage';

const reloadSponsors = vi.fn();
vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition: { id: 5, name: 'Spring Open', sections: [] }, reload: vi.fn(), reloadSponsors }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../competition/sponsorLogo', async (original) => ({ ...(await original<typeof import('../competition/sponsorLogo')>()), prepareLogo: vi.fn() }));
vi.mock('../competition/EmbedCard', () => ({ EmbedCard: () => <p>embed settings</p> }));

const wire = (id: number, extra: Record<string, unknown> = {}) => ({
  id, name: `Sponsor ${id}`, linkUrl: null, logoUrl: null, tier: 1, sortOrder: id, showOn: 4 | 8 | 16 | 32, isEnabled: true, startsAt: null, endsAt: null, views: 0, seconds: 0, ...extra,
});
const show = (lite: 'on' | 'off' = 'off') => {
  const Wrapper = liteWrapper(lite);
  return render(<Wrapper><MemoryRouter><SponsorsSharingPage /></MemoryRouter></Wrapper>);
};
const serve = (...items: unknown[]) => vi.mocked(api.get).mockResolvedValue({ data: items });

beforeEach(() => {
  let blobs = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:logo-${++blobs}`), revokeObjectURL: vi.fn() }));
  serve(wire(1, { name: 'Acme Feeds', showOn: 4 | 32 }), wire(2, { name: 'Bridle Bros', isEnabled: false }), wire(3, { name: 'Oak Saddlery' }));
  vi.mocked(api.put).mockImplementation(async (_url, body) => ({ data: wire(1, { name: 'Acme Feeds', ...(body as object) }) }) as never);
});

describe('SponsorsSharingPage', () => {
  it('lists the sponsors with where they show, a full-width add bar and the share rows', async () => {
    show();
    const list = await screen.findByLabelText('Sponsors');
    expect(api.get).toHaveBeenCalledWith('/competitions/5/sponsors/manage');
    expect(within(list).getByText('2 places')).toBeInTheDocument();
    expect(within(list).getByText('Hidden')).toBeInTheDocument();
    expect(within(list).getByText('Everywhere')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a sponsor' })).toHaveClass('ops-addbar');
    expect(screen.queryByText(/Headline|Major|Supporter|Level|Tier/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Print' })).toHaveAttribute('href', '/event-tools/5/print/poster');
    expect(screen.getByRole('link', { name: 'Get' })).toHaveAttribute('href', expect.stringContaining('/api/competitions/5/calendar.ics'));
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/competitions/5/shop/manage');
  });

  it('says so when there are no sponsors, and offers to try again when loading fails', async () => {
    serve();
    const first = show();
    expect(await screen.findByText('No sponsors yet')).toBeInTheDocument();
    first.unmount();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the sponsors');
    serve(wire(1));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sponsor 1')).toBeInTheDocument();
  });

  it('offers only the four places and saves each switch straight away', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Edit sponsor' })).toBeInTheDocument();
    const places = screen.getByLabelText('Where it shows');
    expect(within(places).getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual(['Event details', 'Live stream', 'Stream breaks', 'Sponsors page']);
    expect(screen.queryByRole('switch', { name: /Timetable|Results/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();

    await user.click(within(places).getByRole('switch', { name: 'Live stream' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/1', expect.objectContaining({ name: 'Acme Feeds', showOn: 4 | 8 | 32, tier: 1 })));
    expect(reloadSponsors).toHaveBeenCalled();
  });

  it('drops the timetable and results places from an old sponsor when it is saved', async () => {
    serve(wire(1, { name: 'Acme Feeds', showOn: 1 | 2 | 4 }));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    await user.click(screen.getByRole('switch', { name: 'Stream breaks' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/1', expect.objectContaining({ showOn: 4 | 16 })));
  });

  it('saves the name and website when they lose focus, and refuses a link that is not https', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Acme Ltd');
    expect(api.put).not.toHaveBeenCalled();
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/1', expect.objectContaining({ name: 'Acme Ltd' })));

    vi.mocked(api.put).mockClear();
    await user.type(screen.getByLabelText('Website'), 'http://nope.example');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('https://');
    expect(api.put).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Website'), 'https://acme.example');
    await user.tab();
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/1', expect.objectContaining({ linkUrl: 'https://acme.example' })));
  });

  it('keeps the old name when it is emptied', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    await user.clear(screen.getByLabelText('Name'));
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('needs a name');
    expect(screen.getByLabelText('Name')).toHaveValue('Acme Feeds');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('sets and clears dates, and hides or shows the sponsor', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    await user.click(screen.getByRole('switch', { name: 'Only between dates' }));
    expect(api.put).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('From'), '2026-11-01');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/1', expect.objectContaining({ startsAt: dateToStart('2026-11-01') })));
    await user.type(screen.getByLabelText('Until'), '2026-11-03');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/1', expect.objectContaining({ endsAt: dateToEnd('2026-11-03') })));
    await user.click(screen.getByRole('switch', { name: 'Showing' }));
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/competitions/5/sponsors/1', expect.objectContaining({ isEnabled: false })));
  });

  it('adds a sponsor once its name is in, then goes on to edit it', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: wire(9, { name: 'New Co' }) });
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a sponsor' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Add a sponsor' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), ' New Co ');
    await user.tab();
    expect(api.post).not.toHaveBeenCalled(); // moving to Website is not leaving the form
    await user.type(screen.getByLabelText('Website'), 'https://new.example');
    await user.click(screen.getByRole('heading', { level: 1 }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/5/sponsors',
      { name: 'New Co', linkUrl: 'https://new.example', tier: 2, showOn: 4 | 32, isEnabled: true, startsAt: null, endsAt: null }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit sponsor' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('New Co');
  });

  it('does not add a sponsor with no name or a link that is not https, and says why a failed add failed', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a sponsor' }));
    await user.click(screen.getByRole('heading', { level: 1 }));
    expect(api.post).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Name'), 'New Co');
    await user.type(screen.getByLabelText('Website'), 'http://x.example');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('https://');
    await user.clear(screen.getByLabelText('Website'));
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t add that sponsor');
    vi.mocked(api.post).mockResolvedValue({ data: wire(9, { name: 'New Co' }) });
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit sponsor' })).toBeInTheDocument();
  });

  it('has a visible Add sponsor pill that stays off until there is a name', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Add a sponsor' }));
    const pill = screen.getByRole('button', { name: 'Add sponsor' });
    expect(pill).toBeDisabled();
    vi.mocked(api.post).mockResolvedValue({ data: wire(9, { name: 'New Co' }) });
    await user.type(screen.getByLabelText('Name'), 'New Co');
    expect(pill).toBeEnabled();
    await user.click(pill);
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit sponsor' })).toBeInTheDocument();
  });

  it('goes back to the list from the back links', async () => {
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    await user.click(screen.getByRole('button', { name: 'Back to sponsors and sharing' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Sponsors and sharing' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Acme Feeds' }));
    await user.click(screen.getByRole('button', { name: 'Sponsors and sharing' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Sponsors and sharing' })).toBeInTheDocument();
  });

  it('removes a sponsor with red text after asking', async () => {
    const asked = autoConfirm([false, true]);
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Bridle Bros' }));
    const remove = screen.getByRole('button', { name: 'Remove this sponsor' });
    expect(remove).toHaveClass('ops-danger-link');
    await user.click(remove);
    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(remove);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/5/sponsors/2'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sponsors and sharing' })).toBeInTheDocument();
    expect(screen.queryByText('Bridle Bros')).not.toBeInTheDocument();
  });

  it('says what went wrong when a change fails', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    await user.click(screen.getByRole('switch', { name: 'Live stream' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save where it shows');
  });

  it('uploads a shrunk logo and removes it', async () => {
    const user = userEvent.setup();
    const shrunk = new Blob(['x'], { type: 'image/webp' });
    vi.mocked(prepareLogo).mockResolvedValue(shrunk);
    vi.mocked(api.put).mockResolvedValue({ data: wire(1, { name: 'Acme Feeds', logoUrl: '/api/competitions/5/sponsors/1/logo?v=1' }) });
    vi.mocked(api.delete).mockResolvedValue({ data: wire(1, { name: 'Acme Feeds' }) });
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    expect(screen.getByText('No logo yet')).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Logo file'), new File(['x'], 'logo.png', { type: 'image/png' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/1/logo', shrunk, { headers: { 'Content-Type': 'image/webp' } }));
    await user.click(await screen.findByRole('button', { name: 'Remove logo' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/competitions/5/sponsors/1/logo'));
    expect(await screen.findByText('No logo yet')).toBeInTheDocument();
  });

  it('says why a logo was refused', async () => {
    const { LogoError } = await import('../competition/sponsorLogo');
    vi.mocked(prepareLogo).mockRejectedValue(new LogoError('Choose a PNG, JPEG or WebP picture.'));
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    await user.upload(screen.getByLabelText('Logo file'), new File(['x'], 'logo.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PNG, JPEG or WebP picture.');
  });

  it('opens the website embed settings and the event link share', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } });
    show();
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/competitions/5'));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Get code' }));
    expect(screen.getByText('embed settings')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Website embed' })).toBeInTheDocument();
  });

  it('offers a link to copy when copying fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
    show();
    await user.click(await screen.findByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('link', { name: 'Copy this link' })).toBeInTheDocument();
  });
});

describe('the logos in the organiser’s list', () => {
  beforeEach(() => {
    serve(wire(1, { name: 'Acme Feeds', logoUrl: '/api/competitions/5/sponsors/1/logo?v=1' }));
    vi.mocked(api.get).mockImplementation(async (url: string) => (url.includes('/logo') ? { data: new Blob(['x']) } : { data: [wire(1, { name: 'Acme Feeds', logoUrl: '/api/competitions/5/sponsors/1/logo?v=1' })] }) as never);
  });

  it('wait for a tap in lite mode, then load with the organiser’s sign-in', async () => {
    const user = userEvent.setup();
    show('on');
    await screen.findByText('Acme Feeds');
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('/logo'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Load image: Acme Feeds logo' }));
    expect(await screen.findByRole('img', { name: 'Acme Feeds logo' })).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions/5/sponsors/1/logo?v=1', { responseType: 'blob' }));
  });

  it('keep the placeholder if the logo cannot be fetched, and give the picture back when leaving', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/logo')) throw new Error('no signal');
      return { data: [wire(1, { name: 'Acme Feeds', logoUrl: '/api/competitions/5/sponsors/1/logo?v=1' })] } as never;
    });
    const failed = show();
    await screen.findByText('Acme Feeds');
    expect(screen.queryByRole('img')).toBeNull();
    failed.unmount();

    vi.mocked(api.get).mockImplementation(async (url: string) => (url.includes('/logo') ? { data: new Blob(['x']) } : { data: [wire(1, { logoUrl: '/api/competitions/5/sponsors/1/logo?v=1' })] }) as never);
    const shown = show();
    await screen.findByRole('img');
    shown.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});


describe('a sponsor’s schedule status', () => {
  const start = Date.parse('2026-06-10T12:00:00Z');
  let now = start;

  beforeEach(() => { now = start; vi.spyOn(Date, 'now').mockImplementation(() => now); });
  afterEach(() => vi.restoreAllMocks());

  it('says Active, Scheduled, Expired or Disabled in words beside the switch', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, 'Active'],
      [{ startsAt: '2026-06-11T00:00:00Z' }, 'Scheduled'],
      [{ endsAt: '2026-06-10T11:00:00Z' }, 'Expired'],
      [{ isEnabled: false }, 'Disabled'],
    ];
    for (const [extra, label] of cases) {
      serve(wire(1, { name: 'Acme Feeds', ...extra }));
      const { unmount } = render(<MemoryRouter><SponsorsSharingPage /></MemoryRouter>);
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
      const row = screen.getByLabelText('Status');
      expect(row.querySelector('.ops-status')).toHaveTextContent(label);
      unmount();
    }
  });

  it('moves from Scheduled to Active on the timer without a reload, then stops the timer on leaving', async () => {
    const callbacks: Array<() => void> = [];
    const realSet = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => { callbacks.push(fn); return realSet(() => undefined, ms); }) as never);
    const clear = vi.spyOn(window, 'clearInterval');
    serve(wire(1, { name: 'Acme Feeds', startsAt: new Date(start + 90_000).toISOString() }));
    const { unmount } = render(<MemoryRouter><SponsorsSharingPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    const row = screen.getByLabelText('Status');
    expect(row).toHaveTextContent('Scheduled');
    now = start + 120_000;
    act(() => callbacks.forEach((fn) => fn()));
    expect(row.querySelector('.ops-status')).toHaveTextContent('Active');
    unmount();
    expect(clear).toHaveBeenCalled();
  });

  it('recomputes when the tab becomes visible or the window regains focus, not while hidden', async () => {
    serve(wire(1, { name: 'Acme Feeds', endsAt: new Date(start + 60_000).toISOString() }));
    render(<MemoryRouter><SponsorsSharingPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Acme Feeds' }));
    const pill = () => screen.getByLabelText('Status').querySelector('.ops-status');
    expect(pill()).toHaveTextContent('Active');
    now = start + 120_000;
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(pill()).toHaveTextContent('Active');
    visibility.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(pill()).toHaveTextContent('Expired');
    now = start;
    act(() => { fireEvent.focus(window); });
    expect(pill()).toHaveTextContent('Active');
  });
});
