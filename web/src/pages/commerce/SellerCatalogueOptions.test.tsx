import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { SellerCataloguePage } from './SellerCataloguePage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const put = vi.mocked(api.put);

const hoodie = {
  id: 20, title: 'Club hoodie', description: 'Warm.', priceMinor: 2800, currency: 'GBP' as const,
  stockQuantity: null, category: 0 as const, imageUrl: null, isActive: true, version: 3,
  createdAt: '', updatedAt: '',
  options: [{ id: 1, label: 'M', stockQuantity: 4 }, { id: 2, label: 'L', stockQuantity: null }],
};

const dialog = () => within(screen.getByRole('dialog'));

function catalogue(items: unknown[]) {
  get.mockImplementation(async (url) => {
    if (url === '/commerce/catalogue') return { data: items } as never;
    if (url === '/commerce/listings/mine') return { data: [] } as never;
    return { data: { items: [], hasMore: false } } as never;
  });
}

const mount = (path = '/me/catalogue') => render(<MemoryRouter initialEntries={[path]}><SellerCataloguePage /></MemoryRouter>);

async function fillBasics() {
  await userEvent.type(dialog().getByLabelText('Name'), 'Tee');
  await userEvent.type(dialog().getByLabelText('Description'), 'A tee.');
  await userEvent.type(dialog().getByLabelText('Price (£)'), '12');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'seller', roles: ['Member'] } } as unknown as ReturnType<typeof useAuth>);
});

describe('Seller catalogue: options', () => {
  it('turns a typed list into removable chips and sends them on create', async () => {
    catalogue([]);
    post.mockResolvedValue({ data: { ...hoodie, id: 30 } } as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await fillBasics();
    await userEvent.type(dialog().getByLabelText('Options (optional)'), 'XS, S, M, S');
    await userEvent.click(dialog().getByRole('button', { name: 'Add options' }));
    const chips = dialog().getByRole('list', { name: 'Options for this item' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['XS', 'S', 'M']);
    await userEvent.click(within(chips).getByRole('button', { name: 'Remove S' }));
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/catalogue', expect.objectContaining({
      options: [{ label: 'XS', stockQuantity: null }, { label: 'M', stockQuantity: null }],
    })));
  });

  it('adds options still sitting in the box when the seller saves, and Enter adds them without saving', async () => {
    catalogue([]);
    post.mockResolvedValue({ data: { ...hoodie, id: 30 } } as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await fillBasics();
    await userEvent.type(dialog().getByLabelText('Options (optional)'), 'S{Enter}');
    expect(post).not.toHaveBeenCalled();
    expect(dialog().getByLabelText('Options (optional)')).toHaveValue('');
    await userEvent.type(dialog().getByLabelText('Options (optional)'), 'L');
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/catalogue', expect.objectContaining({
      options: [{ label: 'S', stockQuantity: null }, { label: 'L', stockQuantity: null }],
    })));
  });

  it('says what is wrong with an option name and does not save', async () => {
    catalogue([]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await fillBasics();
    await userEvent.type(dialog().getByLabelText('Options (optional)'), 'A'.repeat(41));
    expect(dialog().getByRole('alert')).toHaveTextContent('Option names can be at most 40 characters.');
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    expect(post).not.toHaveBeenCalled();
  });

  it('loads an item’s options, keeps their ids and stock, and sends them on update', async () => {
    catalogue([hoodie]);
    put.mockResolvedValue({ data: hoodie } as never);
    mount('/me/catalogue?item=20');
    expect(await screen.findByText('M, L')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const chips = dialog().getByRole('list', { name: 'Options for this item' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['M · 4 left', 'L']);
    await userEvent.click(within(chips).getByRole('button', { name: 'Remove L' }));
    await userEvent.click(dialog().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/catalogue/20', expect.objectContaining({
      options: [{ id: 1, label: 'M', stockQuantity: 4 }],
    })));
  });
});
