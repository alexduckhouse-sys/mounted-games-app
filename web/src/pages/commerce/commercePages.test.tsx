import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { EventShopPage } from './EventShopPage';
import type { EventOrder } from './types';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../competition/context', () => ({ useCompetition: vi.fn() }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
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

async function addCamping() {
  await userEvent.click(await screen.findByRole('button', { name: 'Add one Weekend camping' }));
}

async function addCampingAndOrder() {
  await addCamping();
  await userEvent.click(screen.getByRole('button', { name: 'Order: £25' }));
}

describe('EventShopPage', () => {
  it('groups products by category and uses the server-confirmed total at checkout', async () => {
    shopGet(manualSettings, [listing, { ...listing, id: 11, title: 'Event hoodie', category: 0 as const, stockQuantity: null, description: null }]);
    post.mockResolvedValue({ data: orderOf() } as never);

    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    expect(await screen.findByText('Weekend camping')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Shop switcher' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tack & kit classifieds' })).toHaveAttribute('href', '/shop');
    expect(screen.getByRole('link', { name: 'Your orders' })).toHaveAttribute('href', '/me/orders');
    expect(screen.getByText('£25 · One pitch beside the main arena. · 4 left')).toBeInTheDocument();
    expect(screen.queryByText(/Collect at the event/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Camping', 'Merchandise']);
    expect(screen.getByRole('list', { name: 'Camping for sale' })).toHaveTextContent('Weekend camping');
    expect(screen.getByRole('list', { name: 'Merchandise for sale' })).toHaveTextContent('Event hoodie');
    expect(screen.queryByRole('button', { name: /^Order:/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add one Weekend camping' }));
    await userEvent.click(screen.getByRole('button', { name: 'Order: £25' }));

    expect(await screen.findByRole('heading', { name: 'Order #33' })).toBeInTheDocument();
    expect(screen.getAllByText('£25.00').length).toBeGreaterThan(0);
    expect(post).toHaveBeenCalledWith('/commerce/competitions/5/orders', expect.objectContaining({
      items: [{ listingId: 10, quantity: 1 }],
    }));
    expect(screen.getByText(/Pay the organiser using their usual payment details/)).toBeInTheDocument();
    expect(screen.getByText('This is a demo. No money will be taken or sent, and your order hasn’t been paid for.')).toBeInTheDocument();
  });

  it('says the order is a demo next to the order button, and not before anything is in the basket', async () => {
    shopGet(manualSettings);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await screen.findByText('Weekend camping');
    expect(screen.queryByText('This is a demo. No money will be taken or sent, and your order hasn’t been paid for.')).not.toBeInTheDocument();
    await addCamping();
    expect(screen.getByText('This is a demo. No money will be taken or sent, and your order hasn’t been paid for.')).toBeInTheDocument();
    expect(screen.queryByText('Next you will see a test payment page.')).not.toBeInTheDocument();
  });

  it('shows a sticky basket bar once there is something in the basket, and Checkout takes you to the order button', async () => {
    shopGet(manualSettings, [{ ...listing, id: 11, title: 'Pony hay', stockQuantity: 9, priceMinor: 1600, category: 0 }]);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await screen.findByText('Pony hay');
    expect(screen.queryByRole('region', { name: 'Your basket' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add one Pony hay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one Pony hay' }));
    const bar = screen.getByRole('region', { name: 'Your basket' });
    expect(bar).toHaveTextContent('2 items');
    expect(bar).toHaveTextContent('£32');
    await userEvent.click(within(bar).getByRole('button', { name: 'Checkout' }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Order: £32' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Pony hay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Pony hay' }));
    expect(screen.queryByRole('region', { name: 'Your basket' })).not.toBeInTheDocument();
  });

  it('marks sold-out items and lets the quantity stepper change the basket', async () => {
    shopGet(manualSettings, [{ ...listing, stockQuantity: 0 }, { ...listing, id: 11, title: 'Pony hay', stockQuantity: 3, category: 0 }]);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    expect(await screen.findByText('Sold out')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add one Pony hay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one Pony hay' }));
    expect(screen.getByRole('button', { name: 'Order: £50' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Pony hay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Pony hay' }));
    expect(screen.queryByRole('button', { name: /^Order:/ })).not.toBeInTheDocument();
  });

  it('reuses the order key when a lost response is retried with the same basket', async () => {
    shopGet(manualSettings);
    post.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ data: orderOf({ id: 35, lines: [] }) } as never);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await addCampingAndOrder();
    await screen.findByText(/Couldn’t place your order/);
    await userEvent.click(screen.getByRole('button', { name: 'Order: £25' }));
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

    await addCampingAndOrder();

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
    await addCamping();
    expect(screen.getByRole('link', { name: 'Sign in to order' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: /^Order:/ })).not.toBeInTheDocument();
  });

  describe('demo checkout', () => {
    const demoOrder = orderOf({ id: 34, status: 1, isTestOrder: true });

    async function toPayment() {
      shopGet(demoSettings);
      post.mockResolvedValueOnce({ data: demoOrder } as never);
      render(<MemoryRouter><EventShopPage /></MemoryRouter>);
      await addCamping();
      expect(screen.getByText('This is a demo. No money will be taken or sent, and your order hasn’t been paid for.')).toBeInTheDocument();
      expect(screen.getByText('Next you will see a test payment page.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Order: £25' }));
      expect(await screen.findByRole('heading', { name: /Payment/ })).toHaveTextContent('DEMO');
      expect(screen.getByText('This is a demo. No money will be taken or sent, and your order hasn’t been paid for.')).toBeInTheDocument();
      expect(screen.getByLabelText('Card number')).toHaveValue('4242 4242 4242 4242');
    }

    it('creates the order, then confirms an approved demo payment with a receipt link', async () => {
      await toPayment();
      post.mockResolvedValueOnce({ data: { order: { ...demoOrder, status: 2, testPayments: [testPayment(0)] }, payment: testPayment(0) } } as never);
      await userEvent.click(screen.getByRole('button', { name: 'Pay £25.00' }));
      expect(await screen.findByRole('heading', { name: /Order confirmed/ }, { timeout: 4000 })).toBeInTheDocument();
      expect(post).toHaveBeenLastCalledWith('/commerce/orders/34/demo-checkout', { idempotencyKey: expect.any(String), outcome: 0 });
      expect(screen.getByRole('link', { name: 'View receipt' })).toHaveAttribute('href', '/me/orders?order=34');
      expect(screen.getByText(/^Demo paid £25\.00/)).toBeInTheDocument();
      expect(screen.getByText('This is a demo. No money will be taken or sent, and your order hasn’t been paid for.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Shop' }));
      expect(screen.getByText('Weekend camping')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Order:/ })).not.toBeInTheDocument();
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
      await userEvent.click(screen.getByRole('button', { name: 'Back to shop' }));
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
      expect(screen.getByRole('button', { name: 'Order: £25' })).toBeInTheDocument();

      post.mockResolvedValueOnce({ data: { ...demoOrder, id: 35 } } as never);
      await userEvent.click(screen.getByRole('button', { name: 'Order: £25' }));
      expect(await screen.findByRole('heading', { name: /Payment/ })).toBeInTheDocument();
      const firstKey = (post.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
      const secondCall = post.mock.calls.find((call) => call[0] === '/commerce/competitions/5/orders' && call !== post.mock.calls[0]);
      expect((secondCall![1] as { idempotencyKey: string }).idempotencyKey).not.toBe(firstKey);
    });
  });

  it('shows the question an item asks once it is in the order, and sends the answer with it', async () => {
    shopGet(manualSettings, [{ ...listing, detailPrompt: 'Stable number', detailHint: 'e.g. B12' }, { ...listing, id: 11, title: 'Pony hay', category: 0 as const, stockQuantity: null }]);
    post.mockResolvedValue({ data: orderOf() } as never);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await screen.findByText('Weekend camping');
    expect(screen.queryByLabelText('Stable number')).toBeNull();
    await addCamping();
    expect(screen.getByLabelText('Stable number')).toBeInTheDocument();
    // Only the item that asks has a question: hay adds none.
    await userEvent.click(screen.getByRole('button', { name: 'Add one Pony hay' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    await userEvent.type(screen.getByLabelText('Stable number'), 'B12');
    await userEvent.click(screen.getByRole('button', { name: 'Order: £50' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/5/orders', expect.objectContaining({
      items: [{ listingId: 10, quantity: 1, detail: 'B12' }, { listingId: 11, quantity: 1 }],
    })));
  });

  it('asks nothing extra while the API sends no question, and drops it when the count goes back to none', async () => {
    shopGet(manualSettings, [{ ...listing, detailPrompt: 'Number plate' }]);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    expect(screen.queryByLabelText('Number plate')).toBeNull();
    await addCamping();
    expect(screen.getByLabelText('Number plate')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Weekend camping' }));
    expect(screen.queryByLabelText('Number plate')).toBeNull();
  });

  it('uses a fresh order key when the answer to an item’s question changes', async () => {
    shopGet(manualSettings, [{ ...listing, detailPrompt: 'Stable number' }]);
    post.mockRejectedValue(new Error('lost'));
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await addCamping();
    await userEvent.type(screen.getByLabelText('Stable number'), 'A1');
    await userEvent.click(screen.getByRole('button', { name: 'Order: £25' }));
    await screen.findByText(/Couldn’t place your order/);
    await userEvent.type(screen.getByLabelText('Stable number'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Order: £25' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect((post.mock.calls[1][1] as { idempotencyKey: string }).idempotencyKey).not.toBe((post.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey);
  });

  it('has tabs for the event shop and the tack and kit classifieds, and no small print about collecting or paying', async () => {
    shopGet(manualSettings);
    render(<MemoryRouter><EventShopPage /></MemoryRouter>);
    await screen.findByText('Weekend camping');
    const tabs = screen.getByRole('navigation', { name: 'Shop switcher' });
    expect(within(tabs).getByRole('link', { name: 'Event shop' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText(/Listings approved by the organiser/)).toBeNull();
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
    await userEvent.click(screen.getByRole('button', { name: 'Add one New event camping' }));
    await userEvent.click(screen.getByRole('button', { name: 'Order: £25' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/6/orders',
      expect.objectContaining({ items: [{ listingId: 60, quantity: 1 }] })));
  });
});
