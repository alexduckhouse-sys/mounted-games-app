import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition } from '../../test/factories';
import { liteWrapper } from '../../test/lite';
import { dateToEnd, dateToStart } from '../../lib/sponsors';
import { CompetitionContext } from './context';
import { SponsorsCard } from './SponsorsCard';
import { prepareLogo } from './sponsorLogo';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('./sponsorLogo', async (original) => ({ ...(await original<typeof import('./sponsorLogo')>()), prepareLogo: vi.fn() }));

const wire = (id: number, extra: Record<string, unknown> = {}) => ({
  id, name: `Sponsor ${id}`, linkUrl: null, logoUrl: null, tier: 1, sortOrder: id, showOn: 39, isEnabled: true, startsAt: null, endsAt: null, views: 0, seconds: 0, ...extra,
});
const reloadSponsors = vi.fn();
const show = () => render(
  <CompetitionContext.Provider value={{ competition: competition({ id: 5 }), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [], reloadSponsors }}>
    <SponsorsCard competitionId={5} />
  </CompetitionContext.Provider>,
);
const serve = (...items: unknown[]) => vi.mocked(api.get).mockResolvedValue({ data: items });

beforeEach(() => {
  let blobs = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:logo-${++blobs}`), revokeObjectURL: vi.fn() }));
  serve(wire(1, { name: 'Acme Feeds', tier: 0, views: 1234, seconds: 600, logoUrl: '/api/competitions/5/sponsors/1/logo?v=1' }), wire(2, { name: 'Bridle Bros', isEnabled: false }));
});

describe('SponsorsCard', () => {
  it('lists the sponsors with their tier, state and how often they were shown', async () => {
    show();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the sponsors');
    const list = await screen.findByRole('list', { name: 'Sponsors' });
    expect(api.get).toHaveBeenCalledWith('/competitions/5/sponsors/manage');
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Acme Feeds');
    expect(first).toHaveTextContent('Headline');
    expect(first).toHaveTextContent('Shown 1,234 times · 10 min on video');
    expect(second).toHaveTextContent('Bridle Bros');
    expect(second).toHaveTextContent('Hidden');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions/5/sponsors/1/logo?v=1', { responseType: 'blob' }));
    expect(await within(first).findByRole('img', { name: 'Acme Feeds logo' })).toHaveAttribute('src', 'blob:logo-1');
    expect(within(second).getByText('No logo')).toBeInTheDocument();
  });

  it('says so when there are none, and offers to try again when loading fails', async () => {
    serve();
    const { unmount } = show();
    expect(await screen.findByText(/No sponsors yet/)).toBeInTheDocument();
    unmount();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('no signal'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the sponsors');
    serve(wire(1));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Sponsors' })).toBeInTheDocument();
  });

  it('adds a sponsor with its places, dates and a shrunk logo', async () => {
    const user = userEvent.setup();
    const shrunk = new Blob(['x'], { type: 'image/webp' });
    vi.mocked(prepareLogo).mockResolvedValue(shrunk);
    vi.mocked(api.post).mockResolvedValue({ data: wire(3, { name: 'New Co' }) });
    vi.mocked(api.put).mockResolvedValue({ data: wire(3, { name: 'New Co', logoUrl: '/api/competitions/5/sponsors/3/logo?v=1' }) });
    show();
    await screen.findByRole('list', { name: 'Sponsors' });

    await user.click(screen.getByRole('button', { name: 'Add a sponsor' }));
    const form = screen.getByRole('form', { name: 'Add a sponsor' });
    // The form starts with the pages ticked and the video places not.
    expect(within(form).getByRole('checkbox', { name: /Timetable/ })).toBeChecked();
    expect(within(form).getByRole('checkbox', { name: /Live video/ })).not.toBeChecked();
    expect(within(form).getByRole('button', { name: 'Add sponsor' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Name'), '  New Co ');
    await user.type(within(form).getByLabelText('Link (https)'), 'https://new.example');
    await user.selectOptions(within(form).getByLabelText('Tier'), 'Headline');
    await user.click(within(form).getByRole('checkbox', { name: /Video breaks/ }));
    await user.click(within(form).getByRole('checkbox', { name: /Results/ }));
    await user.type(within(form).getByLabelText('First day (optional)'), '2026-11-01');
    await user.type(within(form).getByLabelText('Last day (optional)'), '2026-11-03');
    await user.upload(within(form).getByLabelText('Logo'), new File(['x'], 'logo.png', { type: 'image/png' }));
    await user.click(within(form).getByRole('button', { name: 'Add sponsor' }));

    expect(api.post).toHaveBeenCalledWith('/competitions/5/sponsors', {
      name: 'New Co', linkUrl: 'https://new.example', tier: 0, showOn: 1 | 4 | 16 | 32, isEnabled: true,
      startsAt: dateToStart('2026-11-01'), endsAt: dateToEnd('2026-11-03'),
    });
    expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/3/logo', shrunk, { headers: { 'Content-Type': 'image/webp' } });
    expect(await screen.findByText('Added New Co.')).toBeInTheDocument();
    expect(screen.getByText('New Co')).toBeInTheDocument();
    expect(reloadSponsors).toHaveBeenCalled();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('refuses a link that is not https before sending anything', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('list', { name: 'Sponsors' });
    await user.click(screen.getByRole('button', { name: 'Add a sponsor' }));
    await user.type(screen.getByLabelText('Name'), 'Odd');
    const link = screen.getByLabelText('Link (https)');
    link.removeAttribute('type');
    await user.type(link, 'http://odd.example');
    await user.click(screen.getByRole('button', { name: 'Add sponsor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The link must start with https://');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('edits a sponsor and can remove its logo', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({ data: wire(1, { name: 'Acme Horse Feeds', tier: 0 }) });
    vi.mocked(api.delete).mockResolvedValue({ data: wire(1, { name: 'Acme Feeds', tier: 0 }) });
    show();
    await screen.findByRole('list', { name: 'Sponsors' });

    await user.click(screen.getByRole('button', { name: 'Edit Acme Feeds' }));
    const form = screen.getByRole('form', { name: 'Edit Acme Feeds' });
    expect(within(form).getByLabelText('Name')).toHaveValue('Acme Feeds');
    expect(within(form).getByLabelText('Tier')).toHaveValue('0');
    await user.click(within(form).getByRole('button', { name: 'Remove logo' }));
    expect(api.delete).toHaveBeenCalledWith('/competitions/5/sponsors/1/logo');
    await waitFor(() => expect(within(form).queryByRole('button', { name: 'Remove logo' })).toBeNull());
    expect(within(form).getByLabelText('Logo')).toBeInTheDocument();

    await user.clear(within(form).getByLabelText('Name'));
    await user.type(within(form).getByLabelText('Name'), 'Acme Horse Feeds');
    await user.click(within(form).getByRole('button', { name: 'Save sponsor' }));
    expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/1', expect.objectContaining({ name: 'Acme Horse Feeds', tier: 0 }));
    expect(await screen.findByText('Saved Acme Horse Feeds.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says what went wrong with a logo or a save, and keeps the form open', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { LogoError } = await import('./sponsorLogo');
    vi.mocked(prepareLogo).mockRejectedValue(new LogoError('Choose a PNG, JPEG or WebP picture.'));
    show();
    await screen.findByRole('list', { name: 'Sponsors' });
    await user.click(screen.getByRole('button', { name: 'Add a sponsor' }));
    await user.type(screen.getByLabelText('Name'), 'Odd');
    await user.upload(screen.getByLabelText('Logo'), new File(['x'], 'logo.gif', { type: 'image/gif' }));
    await user.click(screen.getByRole('button', { name: 'Add sponsor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PNG, JPEG or WebP picture.');
    expect(api.post).not.toHaveBeenCalled();

    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'A competition can have up to 30 sponsors.' } } });
    vi.mocked(prepareLogo).mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Add sponsor' }));
    expect(await screen.findByText('A competition can have up to 30 sponsors.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add a sponsor' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('shows or hides a sponsor with one tap', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({ data: wire(2, { name: 'Bridle Bros', isEnabled: true }) });
    show();
    await screen.findByRole('list', { name: 'Sponsors' });
    await user.click(screen.getByRole('button', { name: 'Hidden' }));
    expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/2', expect.objectContaining({ name: 'Bridle Bros', isEnabled: true }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Hidden' })).toBeNull());
  });

  it('moves a sponsor up or down by sending the whole new order', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockResolvedValue({ data: null });
    show();
    await screen.findByRole('list', { name: 'Sponsors' });
    expect(screen.getByRole('button', { name: 'Move Acme Feeds up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Bridle Bros down' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Bridle Bros up' }));
    expect(api.put).toHaveBeenCalledWith('/competitions/5/sponsors/order', { ids: [2, 1] });
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Sponsors' })).getAllByRole('listitem')[0]).toHaveTextContent('Bridle Bros'));
  });

  it('asks before deleting', async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValue({ data: null });
    show();
    await screen.findByRole('list', { name: 'Sponsors' });
    await user.click(screen.getByRole('button', { name: 'Delete Bridle Bros' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete Bridle Bros' }));
    await user.click(screen.getByRole('button', { name: 'Delete Bridle Bros' }));
    expect(api.delete).toHaveBeenCalledWith('/competitions/5/sponsors/2');
    expect(await screen.findByText('Deleted Bridle Bros.')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('keeps the list and says so when a change fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.put).mockRejectedValue(new Error('no signal'));
    vi.mocked(api.delete).mockRejectedValue(new Error('no signal'));
    show();
    await screen.findByRole('list', { name: 'Sponsors' });
    await user.click(screen.getByRole('button', { name: 'Move Bridle Bros up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change the order');
    await user.click(screen.getByRole('button', { name: 'Hidden' }));
    expect(await screen.findByText('Couldn’t change that sponsor. Try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete Bridle Bros' }));
    await user.click(screen.getByRole('button', { name: 'Delete Bridle Bros' }));
    expect(await screen.findByText('Couldn’t delete Bridle Bros. Try again.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Sponsors' })).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('the logos in the organiser’s list', () => {
  const inContext = (Wrapper: ReturnType<typeof liteWrapper>) => render(
    <Wrapper>
      <CompetitionContext.Provider value={{ competition: competition({ id: 5 }), reload: vi.fn(), streams: [], streamingEnabled: false, invoke: vi.fn(), ready: 1, streamMessages: [], reloadSponsors }}>
        <SponsorsCard competitionId={5} />
      </CompetitionContext.Provider>
    </Wrapper>,
  );

  it('wait for a tap in lite mode, then load with the organiser’s sign-in', async () => {
    const user = userEvent.setup();
    inContext(liteWrapper('on'));
    await screen.findByRole('list', { name: 'Sponsors' });
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).includes('/logo'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Load image: Acme Feeds logo' }));
    expect(await screen.findByRole('img', { name: 'Acme Feeds logo' })).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/competitions/5/sponsors/1/logo?v=1', { responseType: 'blob' }));
  });

  it('keep the placeholder if the logo cannot be fetched, and give the picture back when leaving', async () => {
    const real = vi.mocked(api.get).getMockImplementation();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/logo')) throw new Error('no signal');
      return { data: [wire(1, { name: 'Acme Feeds', logoUrl: '/api/competitions/5/sponsors/1/logo?v=1' })] };
    });
    const failed = inContext(liteWrapper('off'));
    await screen.findByRole('list', { name: 'Sponsors' });
    expect(screen.queryByRole('img')).toBeNull();
    failed.unmount();

    vi.mocked(api.get).mockImplementation(real ?? (async () => ({ data: [wire(1, { logoUrl: '/api/competitions/5/sponsors/1/logo?v=1' })] })));
    serve(wire(1, { logoUrl: '/api/competitions/5/sponsors/1/logo?v=1' }));
    const shown = inContext(liteWrapper('off'));
    await screen.findByRole('img');
    shown.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
