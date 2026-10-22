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


const manualSettings = { data: { competitionId: 5, isDemo: false, isLocked: false, updatedAt: null } };
const demoSettings = { data: { competitionId: 5, isDemo: true, isLocked: false, updatedAt: null } };

function shopGet(settings: typeof manualSettings, listings: unknown[] = [listing]) {
  get.mockImplementation(async (url) => String(url).endsWith('/listings') ? { data: listings } as never : settings as never);
}

function orderOf(overrides: Partial<EventOrder> = {}): EventOrder {
  return {
    id: 33, competitionId: 5, buyerUserId: 'buyer', status: 0, totalMinor: 2500, currency: 'GBP',
    isTestOrder: false, hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null,
    lines: [{ id: 1, listingId: 10, catalogueItemId: 20, sellerUserId: 'seller', title: 'Weekend camping', unitPriceMinor: 2500, quantity: 1, lineTotalMinor: 2500 }],
    testPayments: [], createdAt: '2026-10-18T10:00:00Z', updatedAt: '', ...overrides,
  };
}

function testPayment(status: 0 | 1 | 2 | 3) {
  return {
    id: status + 1, competitionId: 5, target: 0 as const, targetId: 34, operation: 0 as const, requestedOutcome: status === 3 ? null : status as 0 | 1 | 2,
    status, amountMinor: 2500, currency: 'GBP' as const, isTest: true as const, provider: 'fake' as const,
    receiptReference: `TEST-${status + 1}`, receiptLabel: 'TEST PAYMENT — NO MONEY TAKEN', createdAt: '2026-10-18T10:31:00Z',
  };
}

async function addCampingAndReview() {
  await userEvent.click(await screen.findByRole('button', { name: 'Add Weekend camping' }));
  await userEvent.click(screen.getByRole('button', { name: 'Review' }));
}

describe('EventShopPage', () => {
  it('filters products and uses the server-confirmed total at checkout', async () => {
    shopGet(manualSettings);
    post.mockResolvedValue({ data: orderOf() } as never);

    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    expect(await screen.findByText('Weekend camping')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shop' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your orders' })).toHaveAttribute('href', '/me/orders');
    expect(screen.getByText('One pitch beside the main arena.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Tickets' }));
    expect(screen.getByText('There’s nothing in this category yet.')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Camping' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Add Weekend camping' }));
    expect(screen.getByRole('region', { name: 'Basket summary' })).toHaveTextContent('1 item');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText(/Your total is confirmed when you place the order/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByRole('heading', { name: 'Order #33' })).toBeInTheDocument();
    expect(screen.getAllByText('£25.00').length).toBeGreaterThan(0);
    expect(post).toHaveBeenCalledWith('/commerce/competitions/5/orders', expect.objectContaining({
      items: [{ listingId: 10, quantity: 1 }],
    }));
    expect(screen.getByText(/Pay the organiser using their usual payment details/)).toBeInTheDocument();
  });

  it('marks sold-out items and lets the quantity stepper change the basket', async () => {
    shopGet(manualSettings, [{ ...listing, stockQuantity: 0 }, { ...listing, id: 11, title: 'Pony hay', stockQuantity: 3, category: 0 }]);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    expect(await screen.findByText('Sold out')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add Pony hay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one Pony hay' }));
    expect(screen.getByRole('region', { name: 'Basket summary' })).toHaveTextContent('2 items');
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Pony hay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Pony hay' }));
    expect(screen.queryByRole('region', { name: 'Basket summary' })).not.toBeInTheDocument();
  });

  it('reuses the order key when a lost response is retried with the same basket', async () => {
    shopGet(manualSettings);
    post.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ data: orderOf({ id: 35, lines: [] }) } as never);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await addCampingAndReview();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await screen.findByText(/Couldn’t place your order/);
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await screen.findByRole('heading', { name: 'Order #35' });

    const firstBody = post.mock.calls[0][1] as { idempotencyKey: string };
    const retryBody = post.mock.calls[1][1] as { idempotencyKey: string };
    expect(retryBody.idempotencyKey).toBe(firstBody.idempotencyKey);
  });

  it('locks the visible basket while the order request is pending', async () => {
    shopGet(manualSettings);
    const pendingOrder = deferred<{ data: EventOrder }>();
    post.mockReturnValue(pendingOrder.promise as never);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);

    await addCampingAndReview();
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));

    expect(screen.getByRole('button', { name: 'Remove one Weekend camping' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add one Weekend camping' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Placing order…' })).toBeDisabled();

    await act(async () => {
      pendingOrder.resolve({ data: orderOf({ id: 36, lines: [] }) });
      await pendingOrder.promise;
    });
    expect(await screen.findByRole('heading', { name: 'Order #36' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign in instead of placing an order', async () => {
    auth.mockReturnValue({ ...viewer, user: null } as unknown as ReturnType<typeof useAuth>);
    shopGet(manualSettings);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await addCampingAndReview();
    expect(screen.getByRole('link', { name: 'Sign in to order' })).toHaveAttribute('href', '/login');
  });

  describe('demo checkout', () => {
    const demoOrder = orderOf({ id: 34, status: 1, isTestOrder: true });

    async function toPayment() {
      shopGet(demoSettings);
      post.mockResolvedValueOnce({ data: demoOrder } as never);
      render(<MemoryRouter><EventShopPage /></MemoryRouter>);
      await addCampingAndReview();
      expect(screen.getByRole('heading', { name: /Basket/ })).toHaveTextContent('DEMO');
      await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
      expect(await screen.findByRole('heading', { name: /Payment/ })).toHaveTextContent('DEMO');
      expect(screen.getByLabelText('Card number')).toHaveValue('4242 4242 4242 4242');
    }

    it('creates the order, then confirms an approved demo payment with a receipt link', async () => {
      await toPayment();
      post.mockResolvedValueOnce({ data: { order: { ...demoOrder, status: 2, testPayments: [testPayment(0)] }, payment: testPayment(0) } } as never);
      await userEvent.click(screen.getByRole('button', { name: 'Pay £25.00' }));
      expect(await screen.findByRole('heading', { name: /Order confirmed/ }, { timeout: 4000 })).toBeInTheDocument();
      expect(post).toHaveBeenLastCalledWith('/commerce/orders/34/demo-checkout', { idempotencyKey: expect.any(String), outcome: 0 });
      expect(screen.getByRole('link', { name: 'View receipt' })).toHaveAttribute('href', '/me/orders?order=34');
      await userEvent.click(screen.getByRole('button', { name: 'Shop' }));
      expect(screen.getByRole('heading', { name: 'Shop' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Basket summary' })).not.toBeInTheDocument();
    });

    it('keeps the basket after a declined payment and offers another try', async () => {
      await toPayment();
      await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
      post.mockResolvedValueOnce({ data: { order: { ...demoOrder, status: 3, testPayments: [testPayment(1)] }, payment: testPayment(1) } } as never);
      await userEvent.click(screen.getByRole('button', { name: 'Pay £25.00' }));
      expect(await screen.findByRole('heading', { name: /Payment declined/ }, { timeout: 4000 })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Nothing was charged. Order #34 is waiting for payment.');
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(screen.getByLabelText('Card number')).toHaveValue('4242 4242 4242 4242');
      await userEvent.click(screen.getByRole('button', { name: 'Back to basket' }));
      expect(screen.getByText('Weekend camping')).toBeInTheDocument();
    });

    it('says the order was cancelled, keeps the basket, and starts a fresh order next time', async () => {
      await toPayment();
      post.mockResolvedValueOnce({ data: { order: { ...demoOrder, status: 4, testPayments: [testPayment(2)] }, payment: testPayment(2) } } as never);
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByRole('heading', { name: /Checkout cancelled/ }, { timeout: 4000 })).toBeInTheDocument();
      expect(screen.getByText(/Order #34 was cancelled and nothing was charged/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Back to shop' }));
      expect(screen.getByRole('region', { name: 'Basket summary' })).toBeInTheDocument();

      post.mockResolvedValueOnce({ data: { ...demoOrder, id: 35 } } as never);
      await userEvent.click(screen.getByRole('button', { name: 'Review' }));
      await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
      expect(await screen.findByRole('heading', { name: /Payment/ })).toBeInTheDocument();
      const firstKey = (post.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
      const secondCall = post.mock.calls.find((call) => call[0] === '/commerce/competitions/5/orders' && call !== post.mock.calls[0]);
      expect((secondCall![1] as { idempotencyKey: string }).idempotencyKey).not.toBe(firstKey);
    });
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
    post.mockResolvedValue({ data: orderOf({ id: 61, competitionId: 6, lines: [] }) } as never);
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
    await userEvent.click(screen.getByRole('button', { name: 'Add New event camping' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/6/orders',
      expect.objectContaining({ items: [{ listingId: 60, quantity: 1 }] })));
  });
});

const mug = {
  id: 20, title: 'Event mug', description: 'Collect at the event.', priceMinor: 850, currency: 'GBP' as const,
  stockQuantity: 10, category: 0 as const, imageUrl: null, isActive: true, version: 7,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

function catalogueGet(items: unknown[], listings: unknown[] = [], events: unknown[] = [{ id: 5, name: 'Autumn Games', startDate: '2026-10-20' }]) {
  get.mockImplementation(async (url) => {
    if (url === '/commerce/catalogue') return { data: items } as never;
    if (url === '/commerce/listings/mine') return { data: listings } as never;
    return { data: { items: events, hasMore: false } } as never;
  });
}

describe('SellerCataloguePage', () => {
  it('adds an item from the sheet and shows the empty ownership state', async () => {
    catalogueGet([]);
    post.mockResolvedValue({ data: {} } as never);
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);
    expect(await screen.findByText(/Your catalogue is empty/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add item/ }));
    expect(screen.getByRole('dialog', { name: 'Add item' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add a name and description');
    await userEvent.type(screen.getByLabelText('Name'), 'Event mug');
    await userEvent.type(screen.getByLabelText('Description'), 'Collect from the secretary’s tent.');
    await userEvent.type(screen.getByLabelText('Price (£)'), '8.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/catalogue', expect.objectContaining({ priceMinor: 850, stockQuantity: null })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('saves a new item and goes straight to choosing its events', async () => {
    let saved = false;
    get.mockImplementation(async (url) => {
      if (url === '/commerce/catalogue') return { data: saved ? [mug] : [] } as never;
      if (url === '/commerce/listings/mine') return { data: [] } as never;
      return { data: { items: [{ id: 5, name: 'Autumn Games', startDate: '2026-10-20' }], hasMore: false } } as never;
    });
    post.mockImplementation(async () => { saved = true; return { data: mug } as never; });
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: /Add item/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'Event mug');
    await userEvent.type(screen.getByLabelText('Description'), 'Collect at the event.');
    await userEvent.type(screen.getByLabelText('Price (£)'), '8.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save and choose events' }));
    expect(await screen.findByRole('heading', { name: 'Event mug' })).toBeInTheDocument();
    expect(screen.getByText('Autumn Games')).toBeInTheDocument();
  });

  it('summarises where each item is on offer', async () => {
    const listingOf = (id: number, itemId: number, status: 0 | 1 | 2 | 3) => ({
      id, competitionId: 5, catalogueItemId: itemId, sellerUserId: 'buyer', status, reviewNote: status === 2 ? 'Food sellers only at this venue.' : null,
      reviewedAt: null, item: mug, createdAt: '', updatedAt: '',
    });
    catalogueGet(
      [mug, { ...mug, id: 21, title: 'Lead rope' }, { ...mug, id: 22, title: 'Fly spray' }, { ...mug, id: 23, title: 'Old hat', isActive: false }],
      [listingOf(1, 20, 1), listingOf(2, 20, 0), listingOf(3, 21, 2)],
    );
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);
    expect(await screen.findByText('2 events · 1 pending')).toBeInTheDocument();
    expect(screen.getByText('Declined at 1 event')).toBeInTheDocument();
    expect(screen.getByText('Draft · not offered')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lead rope' }));
    await userEvent.click(screen.getByText('Declined'));
    expect(screen.getByText('Organiser: “Food sellers only at this venue.”')).toBeInTheDocument();
  });

  it('lets a seller ask again at an event that declined the item', async () => {
    catalogueGet([mug], [{
      id: 1, competitionId: 5, catalogueItemId: 20, sellerUserId: 'buyer', status: 2, reviewNote: 'Food only.', reviewedAt: null,
      item: mug, createdAt: '', updatedAt: '',
    }]);
    post.mockResolvedValue({ data: {} } as never);
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Event mug' }));
    await userEvent.click(screen.getByText('Offer at another event'));
    await userEvent.click(screen.getByRole('button', { name: 'Request Autumn Games' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/5/listings', { catalogueItemId: 20 }));
  });

  it('sends the loaded catalogue version when editing stock and details', async () => {
    catalogueGet([mug]);
    put.mockResolvedValue({ data: { ...mug, version: 8 } } as never);
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Event mug' }));
    await userEvent.click(screen.getByRole('button', { name: /£8\.50/ }));
    await userEvent.clear(screen.getByLabelText(/Stock/));
    await userEvent.type(screen.getByLabelText(/Stock/), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/catalogue/20',
      expect.objectContaining({ stockQuantity: 12, expectedVersion: 7 })));
  });

  it('keeps the item sheet open while its save request is pending', async () => {
    catalogueGet([], [], []);
    const pendingSave = deferred<{ data: Record<string, never> }>();
    post.mockReturnValue(pendingSave.promise as never);
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: /Add item/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'Event mug');
    await userEvent.type(screen.getByLabelText('Description'), 'Collect at the event.');
    await userEvent.type(screen.getByLabelText('Price (£)'), '8.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save and choose events' })).toBeDisabled();

    await act(async () => {
      pendingSave.resolve({ data: {} });
      await pendingSave.promise;
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/Your catalogue is empty/)).toBeInTheDocument();
  });

  it('archives and restores an item from the item menu', async () => {
    catalogueGet([mug]);
    vi.mocked(api.delete).mockResolvedValue({ data: {} } as never);
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Event mug' }));
    await userEvent.click(screen.getByRole('button', { name: 'More actions for this item' }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive Event mug' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/commerce/catalogue/20'));
  });

  it('loads every upcoming competition picker page', async () => {
    get.mockImplementation(async (url, config) => {
      if (url === '/commerce/catalogue') return { data: [mug] } as never;
      if (url === '/commerce/listings/mine') return { data: [] } as never;
      const page = (config as { params: { page: number } }).params.page;
      return page === 1
        ? { data: { items: [{ id: 5, name: 'First event', startDate: '2026-10-20' }], hasMore: true } } as never
        : { data: { items: [{ id: 6, name: 'Later event', startDate: '2026-11-20' }], hasMore: false } } as never;
    });
    post.mockResolvedValue({ data: {} } as never);
    render(<MemoryRouter><SellerCataloguePage /></MemoryRouter>);

    await userEvent.click(await screen.findByRole('button', { name: 'Event mug' }));
    expect(screen.getByText('First event')).toBeInTheDocument();
    expect(screen.getByText('Later event')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/competitions/picker', { params: { past: false, page: 1, pageSize: 50 } });
    expect(get).toHaveBeenCalledWith('/competitions/picker', { params: { past: false, page: 2, pageSize: 50 } });
    await userEvent.click(screen.getByRole('button', { name: 'Request Later event' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/6/listings', { catalogueItemId: 20 }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
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

  it('labels demo purchases, opens the receipt and keeps sales separate', async () => {
    get.mockImplementation(async (url) => url === '/commerce/orders/mine'
      ? { data: [{
        id: 8, competitionId: 5, buyerUserId: 'buyer', status: 3, totalMinor: 500, currency: 'GBP', isTestOrder: true,
        hasStockReservation: false, paidAt: null, cancelledAt: null, refundedAt: null, lines: [], testPayments: [], createdAt: '2026-10-18T10:00:00Z', updatedAt: '',
      }] } as never
      : { data: [] } as never);
    render(<MemoryRouter><CommerceOrdersPage /></MemoryRouter>);
    expect(await screen.findByText('Demo orders')).toBeInTheDocument();
    expect(screen.getByText('Test payments only')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Order #8/ }));
    expect(screen.getByRole('heading', { name: /Order #8/ })).toHaveTextContent('DEMO');
    await userEvent.click(screen.getByRole('button', { name: 'Retry demo payment' }));
    expect(screen.getByLabelText('Card number')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to order' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back to orders' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Sales' }));
    expect(screen.getByText(/don’t have any event sales/)).toBeInTheDocument();
  });

  it('opens a receipt from the link and refunds a paid demo order after confirming', async () => {
    const paid = {
      id: 9, competitionId: 5, buyerUserId: 'buyer', status: 2, totalMinor: 500, currency: 'GBP', isTestOrder: true,
      hasStockReservation: false, paidAt: '2026-10-18T10:31:00Z', cancelledAt: null, refundedAt: null,
      lines: [{ id: 1, listingId: 10, catalogueItemId: 20, sellerUserId: 'seller', title: 'Event mug', unitPriceMinor: 500, quantity: 1, lineTotalMinor: 500 }],
      testPayments: [{
        id: 1, competitionId: 5, target: 0, targetId: 9, operation: 0, requestedOutcome: 0, status: 0, amountMinor: 500, currency: 'GBP', isTest: true,
        provider: 'fake', receiptReference: 'TEST-1', receiptLabel: 'TEST PAYMENT — NO MONEY TAKEN', createdAt: '2026-10-18T10:31:00Z',
      }],
      createdAt: '2026-10-18T10:00:00Z', updatedAt: '',
    } as EventOrder;
    get.mockImplementation(async (url) => url === '/commerce/orders/mine' ? { data: [paid] } as never : { data: [] } as never);
    post.mockResolvedValue({ data: { order: { ...paid, status: 5 }, payment: { ...paid.testPayments[0], status: 3 } } } as never);
    render(<MemoryRouter initialEntries={['/me/orders?order=9']}><CommerceOrdersPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: /Order #9/ })).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('TEST-1')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Order actions'));
    await userEvent.click(screen.getByRole('button', { name: 'Refund order…' }));
    expect(screen.getByRole('dialog', { name: 'Refund £5.00?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep order' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refund order…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Refund £5.00' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/orders/9/demo-refund', { idempotencyKey: expect.any(String), outcome: 0 }));
    expect(await screen.findByText('Refunded')).toBeInTheDocument();
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
    expect(await screen.findByText('Order #202')).toBeInTheDocument();
    await act(async () => {
      oldOrders.resolve({ data: [{
        id: 101, competitionId: 5, buyerUserId: 'old-user', status: 0, totalMinor: 500, currency: 'GBP', isTestOrder: false,
        hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null, lines: [], testPayments: [], createdAt: '', updatedAt: '',
      }] });
      oldSales.resolve({ data: [] });
      await Promise.resolve();
    });

    expect(screen.queryByText('Order #101')).not.toBeInTheDocument();
  });
});
