import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import * as csv from '../../lib/csv';
import { autoConfirm } from '../../test/confirm';
import { CommerceOrdersPage } from './CommerceOrdersPage';
import type { EventOrder } from './types';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const viewer = { user: { id: 'buyer', email: 'b@example.test', fullName: 'Buyer', clubId: null, clubName: null, roles: ['Member'] } };

const line = { id: 1, listingId: 10, catalogueItemId: 20, sellerUserId: 'seller', title: 'Weekend camping', unitPriceMinor: 2500, quantity: 1, lineTotalMinor: 2500 };

function orderOf(overrides: Partial<EventOrder> = {}): EventOrder {
  return {
    id: 33, competitionId: 5, buyerUserId: 'buyer', status: 0, totalMinor: 2500, currency: 'GBP',
    isTestOrder: false, hasStockReservation: true, paidAt: null, cancelledAt: null, refundedAt: null,
    lines: [line], testPayments: [], createdAt: '2026-10-18T10:00:00Z', updatedAt: '', competitionName: 'Autumn Games', ...overrides,
  };
}

const payment = (status: 0 | 1 | 2 | 3) => ({
  id: status + 1, competitionId: 5, target: 0 as const, targetId: 9, operation: 0 as const, requestedOutcome: 0 as const, status, amountMinor: 500, currency: 'GBP' as const,
  isTest: true as const, provider: 'fake' as const, receiptReference: 'TEST-1', receiptLabel: 'TEST PAYMENT — NO MONEY TAKEN', createdAt: '2026-10-18T10:31:00Z',
});

const sale = (orderId: number, status: 0 | 1 | 2 | 3 | 4 | 5, sellerTotalMinor: number, extra: Record<string, unknown> = {}) => ({
  orderId, competitionId: 5, status, sellerTotalMinor, currency: 'GBP', isTestOrder: false, lines: [{ ...line, title: 'Weekend stabling' }], createdAt: '2026-10-19T09:00:00Z', competitionName: 'Autumn Games', ...extra,
});

function load(orders: unknown[] = [], sales: unknown[] = []) {
  get.mockImplementation(async (url) => ({ data: url === '/commerce/orders/mine' ? orders : sales }) as never);
}

const mount = (path = '/me/orders') => render(<MemoryRouter initialEntries={[path]}><CommerceOrdersPage /></MemoryRouter>);
const dialog = () => within(screen.getByRole('dialog'));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue(viewer as unknown as ReturnType<typeof useAuth>);
});

describe('Orders and sales: bought', () => {
  it('has Bought and Sold tabs, and lists each order with its event, number, date, items, total and a status chip', async () => {
    load([orderOf(), orderOf({ id: 30, status: 2, totalMinor: 2800, competitionName: 'Autumn League', lines: [{ ...line, id: 2, title: 'Club hoodie' }], createdAt: '2026-10-06T10:00:00Z' })]);
    mount();
    expect(screen.getByRole('tab', { name: 'Bought' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Sold' })).toHaveAttribute('aria-selected', 'false');
    const first = await screen.findByRole('button', { name: /Autumn Games/ });
    expect(first).toHaveTextContent('Order 33 · Sun 18 Oct · Weekend camping × 1');
    expect(first).toHaveTextContent('£25.00');
    expect(within(first).getByText('Pay the organiser')).toHaveAttribute('data-tone', 'warn');
    const second = screen.getByRole('button', { name: /Autumn League/ });
    expect(second).toHaveTextContent('Order 30 · Tue 6 Oct · Club hoodie × 1');
    expect(within(second).getByText('Paid')).toHaveAttribute('data-tone', 'good');
    expect(screen.getByText('Pay the organiser directly. They mark the order paid when the money arrives. Collect at the event.')).toBeInTheDocument();
  });

  it('falls back to a plain name when the event is not known', async () => {
    load([orderOf({ competitionName: null })]);
    mount();
    expect(await screen.findByRole('button', { name: /Event order/ })).toBeInTheDocument();
  });

  it('keeps demo orders apart', async () => {
    load([orderOf({ id: 8, isTestOrder: true, status: 3, lines: [] })]);
    mount();
    expect(await screen.findByRole('region', { name: 'Demo orders' })).toHaveTextContent('Test payments only');
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.queryByText(/Pay the organiser directly/)).not.toBeInTheDocument();
  });

  it('says so when there is nothing bought, and when it cannot load', async () => {
    load([]);
    mount();
    expect(await screen.findByText('You haven’t bought anything yet.')).toBeInTheDocument();
  });

  it('shows a problem strip when loading fails, and tries again', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    load([orderOf()]);
    get.mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your orders. Check your signal and try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Autumn Games/ })).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>);
    mount();
    expect(screen.getByText(/Sign in to see your orders and sales/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('Orders and sales: an order in a sheet', () => {
  it('opens a sheet with the details, a red Cancel order and Done', async () => {
    load([orderOf()]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Autumn Games/ }));
    const sheet = screen.getByRole('dialog', { name: 'Order 33' });
    expect(sheet).toHaveTextContent('Autumn Games');
    expect(sheet).toHaveTextContent('Weekend camping × 1');
    expect(sheet).toHaveTextContent('£25.00');
    expect(sheet).toHaveTextContent('Pay the organiser directly. They mark it paid when the money arrives. Collect at the event.');
    expect(dialog().getByRole('button', { name: 'Cancel order' })).toHaveClass('kit-redtext');
    expect(dialog().queryByRole('button', { name: /demo/i })).not.toBeInTheDocument();
    expect(dialog().queryByText(/TEST PAYMENT/)).not.toBeInTheDocument();
    await userEvent.click(dialog().getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancels an order after asking', async () => {
    load([orderOf()]);
    post.mockResolvedValue({ data: {} } as never);
    const asked = autoConfirm([false, true]);
    mount('/me/orders?order=33');
    await screen.findByRole('dialog');
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel order' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Order 33 is cancelled and the items go back on sale.'));
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel order' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/orders/33/cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says so when it cannot cancel', async () => {
    load([orderOf()]);
    post.mockRejectedValue(new Error('offline'));
    autoConfirm(true);
    mount('/me/orders?order=33');
    await screen.findByRole('dialog');
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t cancel the order. Check your signal and try again.');
  });

  it('offers no Cancel order once an order is paid', async () => {
    load([orderOf({ status: 2, paidAt: '2026-10-19T10:00:00Z' })]);
    mount('/me/orders?order=33');
    expect(await screen.findByRole('dialog', { name: 'Order 33' })).toBeInTheDocument();
    expect(dialog().queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Collect at the event.');
  });

  it('pays a demo order from the sheet, and comes back to it', async () => {
    load([orderOf({ id: 8, isTestOrder: true, status: 3, lines: [] })]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Autumn Games/ }));
    expect(screen.getByRole('dialog', { name: 'Order 8 (demo)' })).toBeInTheDocument();
    await userEvent.click(dialog().getByRole('button', { name: 'Retry demo payment' }));
    expect(await screen.findByLabelText('Card number')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to order' }));
    expect(await screen.findByRole('button', { name: /Autumn Games/ })).toBeInTheDocument();
  });

  it('opens a demo order that is waiting for payment with Pay demo order', async () => {
    load([orderOf({ id: 9, isTestOrder: true, status: 1 })]);
    mount('/me/orders?order=9');
    await screen.findByRole('dialog');
    expect(dialog().getByRole('button', { name: 'Pay demo order' })).toHaveClass('kit-pill-fill');
  });

  it('opens a receipt from the link and refunds a paid demo order after confirming', async () => {
    const paid = orderOf({ id: 9, isTestOrder: true, status: 2, totalMinor: 500, paidAt: '2026-10-18T10:31:00Z', lines: [{ ...line, title: 'Event mug', unitPriceMinor: 500, lineTotalMinor: 500 }], testPayments: [payment(0)] });
    load([paid]);
    post.mockResolvedValue({ data: { order: { ...paid, status: 5, competitionName: null }, payment: payment(3) } } as never);
    const asked = autoConfirm([false, true]);
    mount('/me/orders?order=9');
    expect(await screen.findByRole('dialog', { name: 'Order 9 (demo)' })).toBeInTheDocument();
    expect(screen.getByText('TEST-1', { exact: false })).toBeInTheDocument();
    await userEvent.click(dialog().getByRole('button', { name: 'Refund order…' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Refunds the whole of order 9. It’s a demo, so no money moves. The order shows as Refunded.'));
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(dialog().getByRole('button', { name: 'Refund order…' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/orders/9/demo-refund', { idempotencyKey: expect.any(String), outcome: 0 }));
    expect(await dialog().findByText('Refunded')).toBeInTheDocument();
    // The event's name stays, though the refund answer did not repeat it.
    expect(screen.getByRole('dialog')).toHaveTextContent('Autumn Games');
  });

  it('says so when a demo refund fails', async () => {
    load([orderOf({ id: 9, isTestOrder: true, status: 2, paidAt: '2026-10-18T10:31:00Z' })]);
    post.mockRejectedValue(new Error('offline'));
    autoConfirm(true);
    mount('/me/orders?order=9');
    await screen.findByRole('dialog');
    await userEvent.click(dialog().getByRole('button', { name: 'Refund order…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t run the test refund. Check your signal and try again.');
  });
});

describe('Orders and sales: sold', () => {
  it('shows Paid, Not paid yet and Refunded tiles, leaving demo orders out, then the sales and a CSV download', async () => {
    load([], [sale(1, 2, 2500), sale(2, 2, 9000, { isTestOrder: true }), sale(3, 0, 1300), sale(4, 1, 700), sale(5, 5, 2000), sale(6, 3, 4100), sale(7, 4, 800)]);
    const download = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => undefined);
    mount();
    await userEvent.click(screen.getByRole('tab', { name: 'Sold' }));
    const tiles = (await screen.findByText('Paid', { selector: '.cs-tile span' })).closest('.cs-tiles') as HTMLElement;
    expect(within(tiles).getByText('Paid').previousElementSibling).toHaveTextContent('£25.00');
    expect(within(tiles).getByText('Not paid yet').previousElementSibling).toHaveTextContent('£20.00');
    expect(within(tiles).getByText('Refunded').previousElementSibling).toHaveTextContent('£20.00');
    expect(screen.getByRole('heading', { name: /^Sales/ })).toHaveTextContent('Collect at the event');
    expect(screen.getAllByText('Weekend stabling × 1', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Order 2 · demo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download for the treasurer (CSV)' }));
    expect(download).toHaveBeenCalledWith('treasurer-reconciliation.csv', expect.stringContaining('Weekend stabling'));
    expect(download.mock.calls[0][1]).toContain('Stabling & Hook-up');
    expect(download.mock.calls[0][1]).toContain('Yes');
    download.mockRestore();
  });

  it('exports a sale with no lines as one row', async () => {
    load([], [sale(1, 2, 2500, { lines: [] })]);
    const download = vi.spyOn(csv, 'downloadCsv').mockImplementation(() => undefined);
    mount();
    await userEvent.click(screen.getByRole('tab', { name: 'Sold' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Download for the treasurer (CSV)' }));
    expect(download.mock.calls[0][1]).toContain('Order total');
    download.mockRestore();
  });

  it('says so when nothing has been sold, with the tiles at nothing', async () => {
    load([], []);
    mount();
    await userEvent.click(screen.getByRole('tab', { name: 'Sold' }));
    expect(await screen.findByText('You haven’t sold anything yet.')).toBeInTheDocument();
    expect(screen.getAllByText('£0.00')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /CSV/ })).not.toBeInTheDocument();
  });

  it('drops an old account response after the signed-in user changes', async () => {
    const oldOrders = deferred<{ data: EventOrder[] }>();
    const oldSales = deferred<{ data: [] }>();
    let activeUser = { ...viewer.user, id: 'old-user' };
    vi.mocked(useAuth).mockImplementation(() => ({ ...viewer, user: activeUser }) as unknown as ReturnType<typeof useAuth>);
    get.mockImplementation(async (url) => {
      if (activeUser.id === 'old-user') return (url === '/commerce/orders/mine' ? oldOrders.promise : oldSales.promise) as never;
      return { data: url === '/commerce/orders/mine' ? [orderOf({ id: 202, competitionName: 'New Games' })] : [] } as never;
    });
    const view = mount();
    activeUser = { ...viewer.user, id: 'new-user' };
    view.rerender(<MemoryRouter><CommerceOrdersPage /></MemoryRouter>);
    expect(await screen.findByText('New Games')).toBeInTheDocument();
    await act(async () => {
      oldOrders.resolve({ data: [orderOf({ id: 101, competitionName: 'Old Games' })] });
      oldSales.resolve({ data: [] });
      await Promise.resolve();
    });
    expect(screen.queryByText('Old Games')).not.toBeInTheDocument();
  });
});
