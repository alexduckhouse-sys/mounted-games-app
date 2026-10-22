import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ShopClassifieds, ShopPage } from './ShopPage';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: null, canEdit: () => false }) }));

const post = { id: 1, authorName: 'Sam', title: 'Grey saddle', body: 'Barely used', priceMinor: 12000, createdAt: new Date().toISOString(), isDeleted: false, commentCount: 0, reportCount: 0 };

describe('the shop', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      data: url === '/competitions'
        ? [{ id: 4, name: 'Spring Games', isArchived: false }, { id: 5, name: 'Old Games', isArchived: true }]
        : url === '/shop/posts' ? [post] : [],
    }));
  });

  it('brings the event shops and the tack and equipment listings together on /shop', async () => {
    render(<MemoryRouter><ShopPage /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /Spring Games/ })).toHaveAttribute('href', '/competitions/4/shop');
    expect(screen.queryByText(/Old Games/)).not.toBeInTheDocument();
    expect(await screen.findByText('Grey saddle')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Event shops' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tack and equipment' })).toBeInTheDocument();
  });

  it('says so when there are no events', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/shop/posts' ? [] : [] }));
    render(<MemoryRouter><ShopPage /></MemoryRouter>);
    expect(await screen.findByText('No events to shop for right now.')).toBeInTheDocument();
    expect(await screen.findByText(/Nothing for sale yet/)).toBeInTheDocument();
  });

  it('shows the listings inside an event shop with its own intro, and survives an unexpected response', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { not: 'a list' } });
    render(<MemoryRouter><ShopClassifieds intro="Collect it at the event." /></MemoryRouter>);
    expect(screen.getByText('Collect it at the event.')).toBeInTheDocument();
    expect(await screen.findByText(/Nothing for sale yet/)).toBeInTheDocument();
  });
});
