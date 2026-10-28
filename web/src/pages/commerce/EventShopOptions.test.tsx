import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompetition } from '../competition/context';
import { EventShopPage } from './EventShopPage';
import { orderLineText } from './commerceFormat';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../competition/context', () => ({ useCompetition: vi.fn() }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const hoodie = {
  id: 10, competitionId: 5, catalogueItemId: 20, title: 'Club hoodie', description: 'Warm.', priceMinor: 2800, currency: 'GBP' as const,
  stockQuantity: null, category: 0 as const, imageUrl: null,
  options: [
    { id: 1, label: 'S', stockQuantity: 0 },
    { id: 2, label: 'M', stockQuantity: 3 },
    { id: 3, label: 'L', stockQuantity: null },
  ],
};

function mountShop(listings: unknown[] = [hoodie]) {
  get.mockImplementation(async (url) => String(url).endsWith('/listings')
    ? { data: listings } as never
    : { data: { competitionId: 5, isDemo: false, isLocked: false, updatedAt: null } } as never);
  render(<MemoryRouter><EventShopPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'buyer', roles: ['Member'] } } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useCompetition).mockReturnValue({ competition: { id: 5, name: 'Autumn Games' }, reload: vi.fn() } as unknown as ReturnType<typeof useCompetition>);
});

describe('Event shop: options', () => {
  it('shows options as pills with sold out ones disabled and named as such', async () => {
    mountShop();
    const pills = await screen.findByRole('radiogroup', { name: 'Options for Club hoodie' });
    expect(within(pills).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['S, sold out', 'M', 'L']);
    expect(within(pills).getByRole('radio', { name: 'S, sold out' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Add one Club hoodie/ })).not.toBeInTheDocument();
    expect(screen.getByText('Choose an option to add it.')).toBeInTheDocument();
  });

  it('shows Sold out when every option is gone', async () => {
    mountShop([{ ...hoodie, options: [{ id: 1, label: 'S', stockQuantity: 0 }] }]);
    expect(await screen.findByText('Sold out')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('keeps a quantity per option, caps it at the option’s stock and updates the basket bar', async () => {
    mountShop();
    await userEvent.click(await screen.findByRole('radio', { name: 'M' }));
    const add = () => screen.getByRole('button', { name: 'Add one Club hoodie M' });
    await userEvent.click(add());
    await userEvent.click(add());
    await userEvent.click(add());
    expect(add()).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'L' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one Club hoodie L' }));
    const basket = screen.getByRole('button', { name: /^Checkout:/ });
    expect(basket).toHaveAccessibleName('Checkout: 4 items, £112');
    expect(basket).toHaveTextContent('4');
  });

  it('orders one line per option', async () => {
    mountShop();
    post.mockResolvedValue({ data: {
      id: 33, competitionId: 5, buyerUserId: 'buyer', status: 0, totalMinor: 5600, currency: 'GBP', isTestOrder: false, hasStockReservation: true,
      paidAt: null, cancelledAt: null, refundedAt: null, testPayments: [], createdAt: '', updatedAt: '',
      lines: [{ id: 1, listingId: 10, catalogueItemId: 20, sellerUserId: 's', title: 'Club hoodie', optionId: 2, optionLabel: 'M', unitPriceMinor: 2800, quantity: 1, lineTotalMinor: 2800 },
        { id: 2, listingId: 10, catalogueItemId: 20, sellerUserId: 's', title: 'Club hoodie', optionId: 3, optionLabel: 'L', unitPriceMinor: 2800, quantity: 1, lineTotalMinor: 2800 }],
    } } as never);
    await userEvent.click(await screen.findByRole('radio', { name: 'M' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one Club hoodie M' }));
    await userEvent.click(screen.getByRole('radio', { name: 'L' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add one Club hoodie L' }));
    await userEvent.click(screen.getByRole('button', { name: 'Order: £56' }));
    expect(post).toHaveBeenCalledWith('/commerce/competitions/5/orders', expect.objectContaining({
      items: [{ listingId: 10, quantity: 1, optionId: 2 }, { listingId: 10, quantity: 1, optionId: 3 }],
    }));
    const summary = await screen.findByRole('list', { name: 'Order summary' });
    expect(within(summary).getByText('Club hoodie · M × 1')).toBeInTheDocument();
    expect(within(summary).getByText('Club hoodie · L × 1')).toBeInTheDocument();
  });
});

describe('orderLineText', () => {
  it('adds the option to the title', () => {
    expect(orderLineText({ title: 'Club hoodie', optionLabel: 'M', quantity: 2 })).toBe('Club hoodie · M × 2');
    expect(orderLineText({ title: 'Shavings', quantity: 1, detail: 'B12' })).toBe('Shavings × 1 (B12)');
  });
});
