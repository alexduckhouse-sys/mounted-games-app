import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { autoConfirm } from '../../test/confirm';
import { useCompetition } from '../competition/context';
import { CommerceManagementPage } from './CommerceManagementPage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../competition/context', () => ({ useCompetition: vi.fn() }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const put = vi.mocked(api.put);

const organiser = {
  user: { id: 'organiser', email: 'o@example.test', fullName: 'Organiser', clubId: null, clubName: null, roles: ['Trainer'] },
  canOrganise: vi.fn(() => true),
  hasRole: vi.fn(() => false),
  canEdit: vi.fn(() => false),
};

const item = (id: number, title: string, priceMinor: number, stockQuantity: number | null = null) => ({
  id, title, description: 'x', priceMinor, currency: 'GBP' as const, stockQuantity, category: 2 as const, imageUrl: null, isActive: true, version: 1, createdAt: '', updatedAt: '',
});
const listingOf = (id: number, status: 0 | 1 | 2 | 3, title: string, price: number, seller: string | null, stock: number | null = null) => ({
  id, competitionId: 5, catalogueItemId: id + 100, sellerUserId: `s${id}`, status, reviewNote: null, reviewedAt: null, item: item(id + 100, title, price, stock),
  createdAt: '', updatedAt: '', sellerName: seller,
});
const line = (title: string, quantity: number) => ({ id: 1, listingId: 1, catalogueItemId: 1, sellerUserId: 's', title, unitPriceMinor: 100, quantity, lineTotalMinor: 100 * quantity });
const orderOf = (id: number, status: 0 | 1 | 2 | 3 | 4 | 5, buyer: string | null, extra: Record<string, unknown> = {}) => ({
  id, competitionId: 5, buyerUserId: `b${id}`, status, totalMinor: 13000, currency: 'GBP', isTestOrder: false, hasStockReservation: false, paidAt: null, cancelledAt: null,
  refundedAt: null, lines: [line('Weekend stabling', 2)], testPayments: [], createdAt: '', updatedAt: '', buyerName: buyer, ...extra,
});

const settingsOf = (isDemo: boolean, isLocked: boolean) => ({ data: { competitionId: 5, isDemo, isLocked, updatedAt: null } });

function load({ listings = [] as unknown[], orders = [] as unknown[], settings = settingsOf(false, false) } = {}) {
  get.mockImplementation(async (url) => {
    if (String(url).endsWith('/listings/manage')) return { data: listings } as never;
    if (String(url).endsWith('/orders')) return { data: orders } as never;
    return settings as never;
  });
}

const mount = () => render(<MemoryRouter><CommerceManagementPage /></MemoryRouter>);
const tab = (name: string | RegExp) => screen.findByRole('tab', { name });
const dialog = () => within(screen.getByRole('dialog'));

const WAITING = [listingOf(1, 0, 'Weekend stabling', 6500, 'Warwickshire Hunt'), listingOf(2, 0, 'Haynet', 800, 'Sophie Hart', 20)];
const LIVE = [listingOf(3, 1, 'Electric hook-up', 4500, 'Stoneleigh Park'), listingOf(4, 1, 'Shavings bale', 1000, null, 60)];

beforeEach(() => {
  vi.clearAllMocks();
  organiser.canOrganise.mockReturnValue(true);
  vi.mocked(useAuth).mockReturnValue(organiser as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useCompetition).mockReturnValue({ competition: { id: 5, name: 'Autumn Games', createdByUserId: 'organiser' }, reload: vi.fn() } as unknown as ReturnType<typeof useCompetition>);
});

describe('Event shop: access', () => {
  it('keeps organiser controls hidden from another user', () => {
    organiser.canOrganise.mockReturnValue(false);
    mount();
    expect(screen.getByText(/Only this competition’s organiser/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('lets an admin use the buttons straight away, with no edit mode', async () => {
    vi.mocked(useAuth).mockReturnValue({ ...organiser, user: { ...organiser.user, roles: ['Admin'] }, hasRole: vi.fn((role: string) => role === 'Admin'), canEdit: vi.fn(() => true) } as unknown as ReturnType<typeof useAuth>);
    load({ listings: WAITING });
    mount();
    expect(await screen.findByRole('button', { name: 'Approve Haynet' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Decline Haynet' })).toBeEnabled();
    expect(screen.queryByText(/edit mode/i)).not.toBeInTheDocument();
  });
});

describe('Event shop: items', () => {
  it('has Items (n), Orders and Payments tabs, with the waiting items to approve above what is on sale', async () => {
    load({ listings: [...WAITING, ...LIVE] });
    mount();
    expect(await tab('Items (2)')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payments' })).toBeInTheDocument();
    const toApprove = screen.getByRole('heading', { name: /^To approve/ }).nextElementSibling as HTMLElement;
    expect(toApprove).toHaveTextContent('Weekend stabling');
    expect(toApprove).toHaveTextContent('Warwickshire Hunt · Unlimited');
    expect(toApprove).toHaveTextContent('£65.00');
    expect(toApprove).toHaveTextContent('Sophie Hart · 20 available');
    expect(within(toApprove).getByRole('button', { name: 'Approve Haynet' })).toHaveClass('kit-pill-fill');
    expect(within(toApprove).getByRole('button', { name: 'Decline Haynet' })).toHaveClass('kit-redtext');
    const onSale = screen.getByRole('heading', { name: /^On sale/ }).nextElementSibling as HTMLElement;
    expect(onSale).toHaveTextContent('Electric hook-up');
    expect(onSale).toHaveTextContent('Stoneleigh Park · £45.00');
    expect(onSale).toHaveTextContent('A seller · £10.00');
    expect(within(onSale).getAllByText('On sale')).toHaveLength(2);
  });

  it('says so when nothing is waiting or on sale, and drops the count from the tab', async () => {
    load();
    mount();
    expect(await tab('Items')).toBeInTheDocument();
    expect(screen.getByText('Nothing waiting.')).toBeInTheDocument();
    expect(screen.getByText('Nothing on sale yet.')).toBeInTheDocument();
  });

  it('approves an item', async () => {
    load({ listings: WAITING });
    put.mockResolvedValue({ data: {} } as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve Weekend stabling' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/listings/1/approval', { status: 1, reviewNote: null }));
  });

  it('asks for a reason before declining, and sends it as the review note', async () => {
    load({ listings: WAITING });
    put.mockResolvedValue({ data: {} } as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline Weekend stabling' }));
    expect(screen.getByRole('dialog', { name: 'Decline this item?' })).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    await userEvent.type(dialog().getByLabelText('Reason'), '  Only hook-ups at this event.  ');
    await userEvent.click(dialog().getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/listings/1/approval', { status: 2, reviewNote: 'Only hook-ups at this event.' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('declines without a reason as a null note', async () => {
    load({ listings: WAITING });
    put.mockResolvedValue({ data: {} } as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline Haynet' }));
    await userEvent.click(dialog().getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/listings/2/approval', { status: 2, reviewNote: null }));
  });

  it('keeps the sheet open with the reason when declining fails', async () => {
    load({ listings: WAITING });
    put.mockRejectedValue(new Error('offline'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline Haynet' }));
    await userEvent.click(dialog().getByRole('button', { name: 'Decline' }));
    expect(await dialog().findByText('Couldn’t decline the item. Check your signal and try again.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Decline this item?' })).toBeInTheDocument();
  });

  it('says so when approving fails', async () => {
    load({ listings: WAITING });
    put.mockRejectedValue({ response: { data: { message: 'The seller has withdrawn this listing.' } } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve Haynet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The seller has withdrawn this listing.');
  });

  it('lists declined and withdrawn items apart from what is on sale', async () => {
    load({ listings: [listingOf(5, 2, 'Hoodie', 2800, 'Sophie Hart'), listingOf(6, 3, 'Rug', 3000, 'Mark Ellis')] });
    mount();
    const notOnSale = (await screen.findByRole('heading', { name: /^Not on sale/ })).nextElementSibling as HTMLElement;
    expect(within(notOnSale).getByText('Declined')).toBeInTheDocument();
    expect(within(notOnSale).getByText('Withdrawn')).toBeInTheDocument();
  });

  it('says so when it cannot load, and tries again', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    load({ listings: WAITING });
    get.mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the shop. Check your signal and try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Approve Haynet' })).toBeInTheDocument();
  });
});

describe('Event shop: orders', () => {
  it('lists each order with its buyer, items, total and a status chip, and the right button', async () => {
    load({ orders: [
      orderOf(31, 0, 'Jamie Carter'),
      orderOf(30, 2, 'Sophie Hart', { lines: [line('Electric hook-up', 1), line('Shavings bale', 3)], totalMinor: 7500 }),
      orderOf(28, 5, 'Tom Reid', { totalMinor: 2000 }),
      orderOf(27, 0, null),
    ] });
    mount();
    await userEvent.click(await tab('Orders'));
    const rows = screen.getByRole('heading', { name: /^Orders/ }).nextElementSibling as HTMLElement;
    const first = within(rows).getByText('Order 31 · Jamie Carter').closest('.cs-row') as HTMLElement;
    expect(first).toHaveTextContent('Weekend stabling × 2');
    expect(first).toHaveTextContent('£130.00');
    expect(within(first).getByText('Not paid')).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Mark order 31 paid' })).toHaveClass('kit-pill-fill');
    expect(within(first).queryByRole('button', { name: /refunded/ })).not.toBeInTheDocument();
    const paid = within(rows).getByText('Order 30 · Sophie Hart').closest('.cs-row') as HTMLElement;
    expect(paid).toHaveTextContent('Electric hook-up × 1, Shavings bale × 3');
    expect(within(paid).getByRole('button', { name: 'Mark order 30 refunded' })).not.toHaveClass('kit-pill-fill');
    const refunded = within(rows).getByText('Order 28 · Tom Reid').closest('.cs-row') as HTMLElement;
    expect(within(refunded).getByText('Refunded')).toBeInTheDocument();
    expect(within(refunded).queryByRole('button')).not.toBeInTheDocument();
    expect(within(rows).getByText('Order 27 · Buyer')).toBeInTheDocument();
  });

  it('shows what the buyer answered next to the line', async () => {
    load({ orders: [orderOf(31, 0, 'Jamie Carter', { lines: [{ ...line('Shavings', 2), detail: 'B12' }, { ...line('Programme', 1), detail: null }] })] });
    mount();
    await userEvent.click(await tab('Orders'));
    expect(await screen.findByText('Shavings × 2 (B12), Programme × 1')).toBeInTheDocument();
  });

  it('keeps demo orders free of payment buttons', async () => {
    load({ orders: [orderOf(40, 1, 'Test Buyer', { isTestOrder: true }), orderOf(41, 2, 'Test Buyer', { isTestOrder: true })] });
    mount();
    await userEvent.click(await tab('Orders'));
    expect(await screen.findByText('Demo · Payment due')).toBeInTheDocument();
    expect(screen.getByText('Demo paid')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark order/ })).not.toBeInTheDocument();
  });

  it('marks an order paid', async () => {
    load({ orders: [orderOf(31, 0, 'Jamie Carter')] });
    post.mockResolvedValue({ data: {} } as never);
    mount();
    await userEvent.click(await tab('Orders'));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark order 31 paid' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/orders/31/manual-payment', { confirmedExternally: true }));
  });

  it('marks an order refunded only after asking', async () => {
    load({ orders: [orderOf(30, 2, 'Sophie Hart')] });
    post.mockResolvedValue({ data: {} } as never);
    const asked = autoConfirm([false, true]);
    mount();
    await userEvent.click(await tab('Orders'));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark order 30 refunded' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Only do this once the money has gone back to the buyer.'));
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Mark order 30 refunded' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/orders/30/manual-refund', { confirmedExternally: true }));
  });

  it('says so when an order cannot be marked', async () => {
    load({ orders: [orderOf(31, 0, 'Jamie Carter')] });
    post.mockRejectedValue(new Error('offline'));
    mount();
    await userEvent.click(await tab('Orders'));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark order 31 paid' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t mark the order paid. Check your signal and try again.');
  });

  it('says so when there are no orders', async () => {
    load();
    mount();
    await userEvent.click(await tab('Orders'));
    expect(await screen.findByText('No orders yet.')).toBeInTheDocument();
  });
});

describe('Event shop: payments', () => {
  it('shows how people pay as a dropdown row, and changes it before anyone has ordered', async () => {
    load({ settings: settingsOf(false, false) });
    put.mockResolvedValue(settingsOf(true, false) as never);
    mount();
    await userEvent.click(await tab('Payments'));
    const row = await screen.findByRole('combobox', { name: /^How people pay/ });
    expect(row).toHaveTextContent('Pay the organiser');
    expect(screen.getByText('Demo takes no money. Use it to try the shop.')).toBeInTheDocument();
    await userEvent.click(row);
    await userEvent.click(screen.getByRole('option', { name: 'Demo (no money taken)' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/competitions/5/settings', { isDemo: true }));
    expect(await screen.findByRole('combobox', { name: /^How people pay Demo/ })).toBeInTheDocument();
  });

  it('does nothing when the choice is the one already made', async () => {
    load({ settings: settingsOf(true, false) });
    mount();
    await userEvent.click(await tab('Payments'));
    await userEvent.click(await screen.findByRole('combobox', { name: /^How people pay/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Demo (no money taken)' }));
    expect(put).not.toHaveBeenCalled();
  });

  it('locks the row once anyone has ordered', async () => {
    load({ settings: settingsOf(false, true) });
    mount();
    await userEvent.click(await tab('Payments'));
    expect(await screen.findByRole('combobox', { name: /^How people pay/ })).toBeDisabled();
    expect(screen.getByText('Fixed once anyone has ordered.')).toBeInTheDocument();
  });

  it('says so when the change fails', async () => {
    load({ settings: settingsOf(false, false) });
    put.mockRejectedValue(new Error('offline'));
    mount();
    await userEvent.click(await tab('Payments'));
    await userEvent.click(await screen.findByRole('combobox', { name: /^How people pay/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Demo (no money taken)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change how people pay. Check your signal and try again.');
  });
});
