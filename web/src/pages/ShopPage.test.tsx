import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ShopClassifieds, ShopPage } from './ShopPage';

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
      ? [{ id: 4, name: 'Spring Games', location: 'Hartpury', isArchived: false }, { id: 5, name: 'Old Games', isArchived: true }]
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
    expect(screen.getByRole('link', { name: 'Sign in to post' })).toHaveAttribute('href', '/login');
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

  it('switches to the event shops, which skip archived events and can be searched', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Event shops' }));
    expect(await screen.findByRole('link', { name: /Spring Games/ })).toHaveAttribute('href', '/competitions/4/shop');
    expect(screen.queryByText(/Old Games/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Event shops' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No event shops match that search.')).toBeInTheDocument();
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
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
    vi.spyOn(window, 'prompt').mockReturnValue('Looks wrong');
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Grey saddle/ }));
    await userEvent.click(screen.getByRole('button', { name: /Report/ }));
    expect(api.post).toHaveBeenCalledWith('/shop/posts/1/report', { reason: 'Looks wrong' });
    expect(screen.queryByRole('button', { name: 'Remove post' })).not.toBeInTheDocument();
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
