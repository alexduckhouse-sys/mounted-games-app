import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ShopClassifieds, ShopPage } from './ShopPage';
import { TickerProvider, useDockHost, useTicker } from '../components/TickerContext';

import { autoConfirm } from '../test/confirm';
vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ user: null as null | { id: string; fullName: string }, admin: false }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: auth.user, canEdit: () => auth.admin }) }));

const post = { id: 1, authorName: 'Sam', ponyClubName: 'Stockport', title: 'Grey saddle', body: 'Barely used', priceMinor: 12000, contactInfo: 'Text me', createdAt: new Date().toISOString(), isDeleted: false, commentCount: 2, reportCount: 0, authorUserId: 'seller' };
const poles = { ...post, id: 2, title: 'Bending poles', body: 'Set of five', priceMinor: 4500, authorName: 'Pat', ponyClubName: null, authorUserId: 'other', commentCount: 0, createdAt: new Date(Date.now() - 2 * 864e5).toISOString() };

beforeEach(() => {
  auth.user = null;
  auth.admin = false;
  vi.mocked(api.get).mockImplementation(async (url: string) => ({
    data: url === '/competitions'
      ? [{ id: 4, name: 'Spring Games', location: 'Hartpury', isArchived: false }, { id: 5, name: 'Old Games', isArchived: true }, { id: 6, name: 'Empty Games', isArchived: false }]
      : url === '/commerce/competitions/with-items' ? [4, 5]
      : url === '/shop/posts' ? [post, poles] : [],
  }));
});

const mount = () => render(<MemoryRouter><ShopPage /></MemoryRouter>);

describe('the shop', () => {
  it('lists tack and kit as rows with where, when and the price', async () => {
    mount();
    const row = await screen.findByRole('button', { name: /Grey saddle/ });
    expect(row).toHaveTextContent('Sam · Stockport');
    expect(row).toHaveTextContent('just now');
    expect(row).toHaveTextContent('£120.00');
    expect(screen.getByRole('button', { name: /Bending poles/ })).toHaveTextContent('2 days ago');
    // Each listing is its own card with a larger photo, and the sell button is a navy pill that leads to sign-in.
    expect(row.closest('li')).toHaveClass('sp-listing');
    expect(screen.getAllByRole('img', { name: /No photo/ })[0]).toHaveClass('sp-thumb');
    const sell = screen.getByRole('link', { name: 'Sell something' });
    expect(sell).toHaveAttribute('href', '/login');
    expect(sell).toHaveClass('sp-pill', 'sp-pill-fill');
    expect(screen.queryByRole('link', { name: 'Sign in to post' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Community noticeboard/)).not.toBeInTheDocument();
  });

  it('opens a listing to show the description, contact and comments', async () => {
    mount();
    const row = await screen.findByRole('button', { name: /Grey saddle/ });
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Barely used')).toBeInTheDocument();
    expect(screen.getByText('Contact: Text me')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Comments/ })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /Report/ })).toBeInTheDocument();
    await userEvent.click(row);
    expect(screen.queryByText('Barely used')).not.toBeInTheDocument();
  });

  it('searches the listings, and says when nothing matches', async () => {
    mount();
    await screen.findByText('Grey saddle');
    const box = screen.getByRole('searchbox', { name: 'Search the shop' });
    expect(box).toHaveAttribute('placeholder', 'Saddle, bending poles, 13.2…');
    await userEvent.type(box, 'poles');
    expect(screen.queryByText('Grey saddle')).not.toBeInTheDocument();
    expect(screen.getByText('Bending poles')).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'zzz');
    expect(screen.getByText('Nothing matches that search.')).toBeInTheDocument();
  });

  it('filters the listings from a sheet beside the search bar, shows what is set as chips, and clears them one by one', async () => {
    mount();
    await screen.findByText('Grey saddle');
    expect(screen.getByRole('group', { name: 'Shop sections' })).toHaveClass('w-full');
    const open = screen.getByRole('button', { name: 'Filter the shop' });
    expect(open).toHaveClass('fk-fbtn');
    await userEvent.click(open);
    const sheet = screen.getByRole('dialog', { name: 'Filter the shop' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Under £25' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Past week' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // £45 poles are over the £25 line and the £120 saddle is too: nothing is left.
    expect(screen.getByText('Nothing matches that search and those filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter the shop, 2 set' })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Remove Under £25' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Under £25' }));
    expect(screen.getByText('Grey saddle')).toBeInTheDocument();
    expect(screen.getByText('Bending poles')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filter the shop, 1 set' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '£25 to £100' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'With a photo' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'With a photo' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'With a photo' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Grey saddle')).not.toBeInTheDocument();
    expect(screen.getByText('Bending poles')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove £25 to £100' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Past week' }));
    expect(screen.queryByRole('group', { name: 'Filters set' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter the shop' })).toBeInTheDocument();
  });

  it('has no filter button on the event shops tab', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Event shops' }));
    expect(screen.queryByRole('button', { name: /Filter the shop/ })).not.toBeInTheDocument();
  });

  it('switches to the event shops, which skip archived events and can be searched', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Event shops' }));
    expect(await screen.findByRole('link', { name: /Spring Games/ })).toHaveAttribute('href', '/competitions/4/shop');
    expect(screen.queryByText(/Old Games/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Event shops' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No event shops match that search.')).toBeInTheDocument();
  });

  it('lists only the events that have something on sale, with a short note when none do', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Event shops' }));
    expect(await screen.findByRole('link', { name: /Spring Games/ })).toBeInTheDocument();
    expect(screen.queryByText(/Empty Games/)).not.toBeInTheDocument();
  });

  it('says so when no event shop has anything for sale', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/competitions' ? [{ id: 6, name: 'Empty Games', isArchived: false }] : [] }));
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Event shops' }));
    expect(await screen.findByText('No event shops have anything for sale yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Empty Games/)).not.toBeInTheDocument();
  });

  it('shows every live event rather than hide them all when the list of stocked events cannot be fetched', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/commerce/competitions/with-items') throw new Error('offline');
      return { data: url === '/competitions' ? [{ id: 6, name: 'Empty Games', isArchived: false }] : [] };
    });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Event shops' }));
    expect(await screen.findByRole('link', { name: /Empty Games/ })).toBeInTheDocument();
  });

  it('says so when there are no events', async () => {
    vi.mocked(api.get).mockImplementation(async () => ({ data: [] }));
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Event shops' }));
    expect(await screen.findByText('No events to shop for right now.')).toBeInTheDocument();
  });

  it('says when there is nothing for sale', async () => {
    vi.mocked(api.get).mockImplementation(async () => ({ data: [] }));
    mount();
    expect(await screen.findByText(/Nothing for sale yet/)).toBeInTheDocument();
  });

  it('lets a signed-in person open the Sell something form, and lets the seller or an admin remove a post', async () => {
    auth.user = { id: 'seller', fullName: 'Sam Seller' };
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    autoConfirm(true);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Grey saddle/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove post' }));
    expect(api.delete).toHaveBeenCalledWith('/shop/posts/1');
    expect(screen.queryByRole('button', { name: /Report/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sell something' }));
    expect(screen.getByText('New shop post')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('New shop post')).not.toBeInTheDocument();
  });

  it('lets someone report a post that is not theirs', async () => {
    auth.user = { id: 'buyer', fullName: 'Bea Buyer' };
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Grey saddle/ }));
    await userEvent.click(screen.getByRole('button', { name: /Report/ }));
    await userEvent.type(screen.getByLabelText(/Why are you reporting this post/), 'Looks wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(api.post).toHaveBeenCalledWith('/shop/posts/1/report', { reason: 'Looks wrong' });
    expect(await screen.findByText('Reported. An admin will look at it.')).toHaveClass('kit-toast-text');
    expect(screen.queryByRole('button', { name: 'Remove post' })).not.toBeInTheDocument();
  });

  it('keeps a failed report open for retry and lets someone cancel without reporting', async () => {
    auth.user = { id: 'fake-buyer', fullName: 'Fake Buyer' };
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: {} });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Grey saddle/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Report' }));
    await userEvent.type(screen.getByLabelText(/Why are you reporting this post/), 'Fake report reason');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Report' }));
    const reason = screen.getByLabelText(/Why are you reporting this post/);
    expect(reason).toHaveValue('');
    expect(reason).toHaveAttribute('maxlength', '1000');
    await userEvent.type(reason, 'Fake report reason');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t send the report. Check your signal and try again.');
    expect(reason).toHaveValue('Fake report reason');
    expect(screen.queryByText('Reported. An admin will look at it.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Reported. An admin will look at it.')).toHaveClass('kit-toast-text');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('marks a removed post', async () => {
    vi.mocked(api.get).mockImplementation(async () => ({ data: [{ ...post, isDeleted: true }] }));
    mount();
    expect(await screen.findByRole('button', { name: /Grey saddle/ })).toHaveTextContent('Removed');
  });

  it('shows the listings inside an event shop with its own intro and a New post button, and survives an unexpected response', async () => {
    auth.user = { id: 'buyer', fullName: 'Bea Buyer' };
    vi.mocked(api.get).mockResolvedValue({ data: { not: 'a list' } });
    render(<MemoryRouter><ShopClassifieds intro="Collect it at the event." /></MemoryRouter>);
    expect(screen.getByText('Collect it at the event.')).toBeInTheDocument();
    expect(await screen.findByText(/Nothing for sale yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New post' }));
    expect(within(screen.getByText('New shop post').parentElement!).getByLabelText(/Title/)).toBeInTheDocument();
  });
});

describe('the shop comments', () => {
  const comment = { id: 9, authorName: 'Pat', body: 'Still available?', isPrivate: false, createdAt: new Date().toISOString() };

  async function openComments() {
    auth.user = { id: 'buyer', fullName: 'Bea Buyer' };
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/shop/posts' ? [poles] : url.endsWith('/comments') ? [comment] : [] }));
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Bending poles/ }));
    await userEvent.click(screen.getByRole('button', { name: /Comments/ }));
    await screen.findByText('Still available?');
  }

  it('sends from the round navy arrow button, faded until there is something to send', async () => {
    await openComments();
    const send = screen.getByRole('button', { name: 'Send comment' });
    expect(send).toHaveClass('ev-send');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /comment/i }), 'Is it still free?');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(api.post).toHaveBeenCalledWith('/shop/posts/2/comments', expect.objectContaining({ body: 'Is it still free?' }));
  });

  it('shows the time quietly and legibly, not in tiny slate type', async () => {
    await openComments();
    const stamp = screen.getByText('just now', { selector: 'span.ml-1\\.5' });
    expect(stamp.className).toContain('--mg-faint');
    expect(stamp.className).not.toContain('slate');
    expect(stamp.className).not.toContain('text-[9px]');
  });
});

describe('the Sell something button beside the ticker dock', () => {
  function Probe() {
    useDockHost();
    const { dockAction } = useTicker();
    return dockAction ? <button type="button" data-testid="dock" onClick={dockAction.onClick}>{dockAction.label}</button> : null;
  }

  it('moves the pinned bar to the dock and opens the form in a sheet', async () => {
    auth.user = { id: 'seller', fullName: 'Sam Seller' };
    render(<MemoryRouter><TickerProvider><ShopPage /><Probe /></TickerProvider></MemoryRouter>);
    await screen.findByText('Grey saddle');
    expect(document.querySelector('.sp-sell-bar')).toBeNull();
    await userEvent.click(screen.getByTestId('dock'));
    expect(within(screen.getByRole('dialog')).getByText('New shop post')).toBeInTheDocument();
  });
});
