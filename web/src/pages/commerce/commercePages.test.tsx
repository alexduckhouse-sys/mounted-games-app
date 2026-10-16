import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { CommerceManagementPage } from './CommerceManagementPage';
import { CommerceOrdersPage } from './CommerceOrdersPage';
import { DemoEntryPayment } from './DemoEntryPayment';
import { EventShopPage } from './EventShopPage';
import { SellerCataloguePage } from './SellerCataloguePage';
import type { EventOrder } from './types';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../competition/context', () => ({ useCompetition: vi.fn() }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const put = vi.mocked(api.put);
const auth = vi.mocked(useAuth);
const competition = vi.mocked(useCompetition);

const viewer = {
  user: { id: 'buyer', email: 'buyer@example.test', fullName: 'Buyer', clubId: null, clubName: null, roles: ['Member'] },
  canOrganise: vi.fn(() => false),
  hasRole: vi.fn(() => false),
  canEdit: vi.fn(() => false),
};

const listing = {
  id: 10,
  competitionId: 5,
  catalogueItemId: 20,
  title: 'Weekend camping',
  description: 'One pitch beside the main arena.',
  priceMinor: 2500,
  currency: 'GBP' as const,
  stockQuantity: 4,
  category: 2 as const,
  imageUrl: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockReturnValue(viewer as unknown as ReturnType<typeof useAuth>);
  competition.mockReturnValue({ competition: { id: 5, name: 'Autumn Games', createdByUserId: 'organiser' }, reload: vi.fn() } as unknown as ReturnType<typeof useCompetition>);
});

describe('EventShopPage', () => {
  it('filters products and uses the server-confirmed total at checkout', async () => {
    get.mockImplementation(async (url) => {
      if (String(url).endsWith('/listings')) return { data: [listing] } as never;
      return { data: { competitionId: 5, isDemo: false, isLocked: false, updatedAt: null } } as never;
    });
    post.mockResolvedValue({ data: {
      id: 33, competitionId: 5, buyerUserId: 'buyer', status: 0, totalMinor: 2500, currency: 'GBP',
      isTestOrder: false, hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null,
      lines: [{ id: 1, listingId: 10, catalogueItemId: 20, sellerUserId: 'seller', title: 'Weekend camping', unitPriceMinor: 2500, quantity: 1, lineTotalMinor: 2500 }],
      testPayments: [], createdAt: '', updatedAt: '',
    } } as never);

    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    expect(await screen.findByText('Weekend camping')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tickets' }));
    expect(screen.getByText('There’s nothing in this category yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Camping' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one Weekend camping' }));
    expect(screen.getByText('Your total is confirmed when you place the order. Collect everything at the event.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByRole('heading', { name: 'Order #33' })).toBeInTheDocument();
    expect(screen.getByText('£25.00', { selector: 'strong' })).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/commerce/competitions/5/orders', expect.objectContaining({
      items: [{ listingId: 10, quantity: 1 }],
    }));
    expect(screen.getByText(/Pay the organiser using their usual payment details/)).toBeInTheDocument();
  });

  it('reuses the order key when a lost response is retried with the same basket', async () => {
    get.mockImplementation(async (url) => String(url).endsWith('/listings')
      ? { data: [listing] } as never
      : { data: { competitionId: 5, isDemo: false, isLocked: false, updatedAt: null } } as never);
    const responseOrder = {
      id: 35, competitionId: 5, buyerUserId: 'buyer', status: 0, totalMinor: 2500, currency: 'GBP',
      isTestOrder: false, hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null,
      lines: [], testPayments: [], createdAt: '', updatedAt: '',
    };
    post.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ data: responseOrder } as never);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Add one Weekend camping' }));
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await screen.findByText(/Couldn’t place your order/);
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await screen.findByRole('heading', { name: 'Order #35' });

    const firstBody = post.mock.calls[0][1] as { idempotencyKey: string };
    const retryBody = post.mock.calls[1][1] as { idempotencyKey: string };
    expect(retryBody.idempotencyKey).toBe(firstBody.idempotencyKey);
  });

  it('shows test controls only when the event is marked demo', async () => {
    get.mockImplementation(async (url) => String(url).endsWith('/listings')
      ? { data: [listing] } as never
      : { data: { competitionId: 5, isDemo: true, isLocked: false, updatedAt: null } } as never);
    post.mockResolvedValue({ data: {
      id: 34, competitionId: 5, buyerUserId: 'buyer', status: 1, totalMinor: 2500, currency: 'GBP',
      isTestOrder: true, hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null,
      lines: [], testPayments: [], createdAt: '', updatedAt: '',
    } } as never);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Add one Weekend camping' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create demo order' }));
    expect(await screen.findByText('DEMO — no money is taken')).toBeInTheDocument();
    expect(screen.queryByLabelText(/card/i)).not.toBeInTheDocument();
  });

  it('drops an old event response and checks out only against the new event', async () => {
    const oldListings = deferred<{ data: typeof listing[] }>();
    const oldSettings = deferred<{ data: { competitionId: number; isDemo: boolean; isLocked: boolean; updatedAt: null } }>();
    let activeCompetition = { id: 5, name: 'Old Games', createdByUserId: 'organiser' };
    competition.mockImplementation(() => ({ competition: activeCompetition, reload: vi.fn() }) as unknown as ReturnType<typeof useCompetition>);
    const newListing = { ...listing, id: 60, competitionId: 6, title: 'New event camping' };
    get.mockImplementation(async (url) => {
      if (url === '/commerce/competitions/5/listings') return oldListings.promise as never;
      if (url === '/commerce/competitions/5/settings') return oldSettings.promise as never;
      if (url === '/commerce/competitions/6/listings') return { data: [newListing] } as never;
      return { data: { competitionId: 6, isDemo: false, isLocked: false, updatedAt: null } } as never;
    });
    post.mockResolvedValue({ data: {
      id: 61, competitionId: 6, buyerUserId: 'buyer', status: 0, totalMinor: 2500, currency: 'GBP',
      isTestOrder: false, hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null,
      lines: [], testPayments: [], createdAt: '', updatedAt: '',
    } } as never);
    const view = render(<MemoryRouter><EventShopPage /></MemoryRouter>);

    activeCompetition = { id: 6, name: 'New Games', createdByUserId: 'organiser' };
    view.rerender(<MemoryRouter><EventShopPage /></MemoryRouter>);
    expect(await screen.findByText('New event camping')).toBeInTheDocument();
    await act(async () => {
      oldListings.resolve({ data: [listing] });
      oldSettings.resolve({ data: { competitionId: 5, isDemo: false, isLocked: false, updatedAt: null } });
      await Promise.resolve();
    });

    expect(screen.queryByText('Weekend camping')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add one New event camping' }));
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/6/orders',
      expect.objectContaining({ items: [{ listingId: 60, quantity: 1 }] })));
  });
});

describe('SellerCataloguePage', () => {
  it('submits a GBP item form and shows the empty ownership state', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/commerce/catalogue') return { data: [] } as never;
      if (url === '/commerce/listings/mine') return { data: [] } as never;
      return { data: { items: [{ id: 5, name: 'Autumn Games', startDate: '2026-10-20' }], hasMore: false } } as never;
    });
    post.mockResolvedValue({ data: {} } as never);
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);
    expect(await screen.findByText(/Your catalogue is empty/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add item/ }));
    await userEvent.type(screen.getByLabelText('Title'), 'Event mug');
    await userEvent.type(screen.getByLabelText('Description'), 'Collect from the secretary’s tent.');
    await userEvent.type(screen.getByLabelText('Price in GBP'), '8.50');
    await userEvent.click(screen.getByRole('button', { name: 'Add to catalogue' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/catalogue', expect.objectContaining({ priceMinor: 850, stockQuantity: null })));
  });

  it('sends the loaded catalogue version when editing stock and details', async () => {
    const item = {
      id: 20, title: 'Event mug', description: 'Collect at the event.', priceMinor: 850, currency: 'GBP' as const,
      stockQuantity: 10, category: 0 as const, imageUrl: null, isActive: true, version: 7,
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    };
    get.mockImplementation(async (url) => {
      if (url === '/commerce/catalogue') return { data: [item] } as never;
      if (url === '/commerce/listings/mine') return { data: [] } as never;
      return { data: { items: [{ id: 5, name: 'Autumn Games', startDate: '2026-10-20' }], hasMore: false } } as never;
    });
    put.mockResolvedValue({ data: { ...item, version: 8 } } as never);
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);
    await screen.findByText('Event mug');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Event mug' }));
    await userEvent.clear(screen.getByLabelText(/Stock/));
    await userEvent.type(screen.getByLabelText(/Stock/), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/catalogue/20',
      expect.objectContaining({ stockQuantity: 12, expectedVersion: 7 })));
  });

  it('loads every upcoming competition picker page', async () => {
    get.mockImplementation(async (url, config) => {
      if (url === '/commerce/catalogue' || url === '/commerce/listings/mine') return { data: [] } as never;
      const page = (config as { params: { page: number } }).params.page;
      return page === 1
        ? { data: { items: [{ id: 5, name: 'First event', startDate: '2026-10-20' }], hasMore: true } } as never
        : { data: { items: [{ id: 6, name: 'Later event', startDate: '2026-11-20' }], hasMore: false } } as never;
    });
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);

    expect(await screen.findByRole('option', { name: 'Later event' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/competitions/picker', { params: { past: false, page: 1, pageSize: 50 } });
    expect(get).toHaveBeenCalledWith('/competitions/picker', { params: { past: false, page: 2, pageSize: 50 } });
  });
});

describe('ownership and demo states', () => {
  it('keeps organiser controls hidden from another user', () => {
    render(<CommerceManagementPage />);
    expect(screen.getByText(/Only this competition’s organiser/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps admin shop mutations disabled in view-only mode', async () => {
    auth.mockReturnValue({
      ...viewer,
      user: { ...viewer.user, id: 'admin', roles: ['Admin'] },
      canOrganise: vi.fn(() => true),
      hasRole: vi.fn((role: string) => role === 'Admin'),
      canEdit: vi.fn(() => false),
    } as unknown as ReturnType<typeof useAuth>);
    get.mockImplementation(async (url) => {
      if (String(url).endsWith('/listings/manage')) return { data: [{
        id: 40, competitionId: 5, catalogueItemId: 20, sellerUserId: 'seller', status: 0,
        reviewNote: null, reviewedAt: null, createdAt: '', updatedAt: '',
        item: {
          id: 20, title: 'Event mug', description: 'Collect at the event.', priceMinor: 850, currency: 'GBP',
          stockQuantity: 4, category: 0, imageUrl: null, isActive: true, version: 1, createdAt: '', updatedAt: '',
        },
      }] } as never;
      if (String(url).endsWith('/orders')) return { data: [] } as never;
      return { data: { competitionId: 5, isDemo: false, isLocked: false, updatedAt: null } } as never;
    });
    render(<CommerceManagementPage />);

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Manual' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Demo' })).toBeDisabled();
    expect(screen.getByText(/Admin view only is on/)).toBeInTheDocument();
  });

  it('does not show entry test payment controls on a real event', async () => {
    get.mockResolvedValue({ data: { competitionId: 5, isDemo: false, isLocked: false, updatedAt: null } } as never);
    render(<DemoEntryPayment signupId={42} amountMinor={500} signupStatus={0} onChanged={vi.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByText('DEMO — no money is taken')).not.toBeInTheDocument();
  });

  it('labels demo purchases without exposing sales from another seller', async () => {
    get.mockImplementation(async (url) => url === '/commerce/orders/mine'
      ? { data: [{
        id: 8, competitionId: 5, buyerUserId: 'buyer', status: 3, totalMinor: 500, currency: 'GBP', isTestOrder: true,
        hasStockReservation: false, paidAt: null, cancelledAt: null, refundedAt: null, lines: [], testPayments: [], createdAt: '', updatedAt: '',
      }] } as never
      : { data: [] } as never);
    render(<MemoryRouter><CommerceOrdersPage /></MemoryRouter>);
    expect(await screen.findByText('Demo · Test payment declined')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sales' }));
    expect(screen.getByText(/don’t have any event sales/)).toBeInTheDocument();
  });

  it('drops an old account response after the signed-in user changes', async () => {
    const oldOrders = deferred<{ data: EventOrder[] }>();
    const oldSales = deferred<{ data: [] }>();
    let activeUser = { ...viewer.user, id: 'old-user' };
    auth.mockImplementation(() => ({ ...viewer, user: activeUser }) as unknown as ReturnType<typeof useAuth>);
    get.mockImplementation(async (url) => {
      if (activeUser.id === 'old-user') return (url === '/commerce/orders/mine' ? oldOrders.promise : oldSales.promise) as never;
      return url === '/commerce/orders/mine'
        ? { data: [{
          id: 202, competitionId: 6, buyerUserId: 'new-user', status: 0, totalMinor: 800, currency: 'GBP', isTestOrder: false,
          hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null, lines: [], testPayments: [], createdAt: '', updatedAt: '',
        }] } as never
        : { data: [] } as never;
    });
    const view = render(<MemoryRouter><CommerceOrdersPage /></MemoryRouter>);

    activeUser = { ...viewer.user, id: 'new-user' };
    view.rerender(<MemoryRouter><CommerceOrdersPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Order #202' })).toBeInTheDocument();
    await act(async () => {
      oldOrders.resolve({ data: [{
        id: 101, competitionId: 5, buyerUserId: 'old-user', status: 0, totalMinor: 500, currency: 'GBP', isTestOrder: false,
        hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null, lines: [], testPayments: [], createdAt: '', updatedAt: '',
      }] });
      oldSales.resolve({ data: [] });
      await Promise.resolve();
    });

    expect(screen.queryByRole('heading', { name: 'Order #101' })).not.toBeInTheDocument();
  });
});
