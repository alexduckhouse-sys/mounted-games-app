import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { autoConfirm } from '../../test/confirm';
import { SellerCataloguePage } from './SellerCataloguePage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const put = vi.mocked(api.put);
const del = vi.mocked(api.delete);

const viewer = { user: { id: 'seller', email: 's@example.test', fullName: 'Seller', clubId: null, clubName: null, roles: ['Member'] } };

const mug = {
  id: 20, title: 'Event mug', description: 'Collect at the event.', priceMinor: 850, currency: 'GBP' as const,
  stockQuantity: 10, category: 0 as const, imageUrl: null, isActive: true, version: 7,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

const listingOf = (id: number, itemId: number, status: 0 | 1 | 2 | 3, competitionId = 5, reviewNote: string | null = null) => ({
  id, competitionId, catalogueItemId: itemId, sellerUserId: 'seller', status, reviewNote, reviewedAt: null, item: mug, createdAt: '', updatedAt: '',
});

const AUTUMN = { id: 5, name: 'Autumn Games', startDate: '2026-10-20' };
const WINTER = { id: 6, name: 'Winter Games', startDate: '2026-12-05' };

function catalogueGet(items: unknown[], listings: unknown[] = [], events: unknown[] = [AUTUMN]) {
  get.mockImplementation(async (url) => {
    if (url === '/commerce/catalogue') return { data: items } as never;
    if (url === '/commerce/listings/mine') return { data: listings } as never;
    return { data: { items: events, hasMore: false } } as never;
  });
}

const mount = (path = '/me/catalogue') => render(<MemoryRouter initialEntries={[path]}><SellerCataloguePage /></MemoryRouter>);
const dialog = () => within(screen.getByRole('dialog'));
const openItem = async (name: string) => userEvent.click(await screen.findByRole('button', { name }));
const eventRow = (name: string) => screen.getByText(name).closest('.cs-row') as HTMLElement;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue(viewer as unknown as ReturnType<typeof useAuth>);
  del.mockResolvedValue({ data: {} } as never);
});

describe('Things I sell: the list', () => {
  it('shows each item with its initials, a summary line, its price and a chevron, and a grey add bar under them', async () => {
    catalogueGet(
      [mug, { ...mug, id: 21, title: 'Lead rope', priceMinor: 1200 }, { ...mug, id: 22, title: 'Fly spray' }, { ...mug, id: 23, title: 'Old hat', isActive: false }, { ...mug, id: 24, title: 'Photo mug', imageUrl: 'https://example.test/m.jpg' }],
      [listingOf(1, 20, 1), listingOf(2, 20, 0, 6), listingOf(3, 21, 2)],
      [AUTUMN, WINTER],
    );
    mount();
    expect(await screen.findByText('2 events · 1 waiting')).toHaveClass('cs-amber');
    expect(screen.getByText('Declined at 1 event')).toHaveClass('cs-red');
    expect(screen.getAllByText('Not offered anywhere')).toHaveLength(2);
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Old hat' })).toHaveClass('cs-faded');
    expect(screen.getByRole('button', { name: 'Event mug' })).not.toHaveClass('cs-faded');
    expect(within(screen.getByRole('button', { name: 'Event mug' })).getByText('EM')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Lead rope' })).getByText('£12.00')).toBeInTheDocument();
    expect(document.querySelector('img.cs-thumb')).toHaveAttribute('src', 'https://example.test/m.jpg');
    expect(screen.getByText('5', { selector: 'small' })).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add an item' });
    expect(add).toHaveClass('sp-add');
    expect(add.parentElement).toHaveClass('sp-card');
  });

  it('has no explanatory notes under the list', async () => {
    catalogueGet([mug]);
    mount();
    await screen.findByRole('button', { name: 'Event mug' });
    expect(screen.queryByText(/Add an item once/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Orders for your items/)).not.toBeInTheDocument();
  });

  it('shows only the add bar when there is nothing yet', async () => {
    catalogueGet([]);
    mount();
    expect(await screen.findByRole('button', { name: 'Add an item' })).toBeInTheDocument();
    expect(screen.queryByText(/catalogue is empty/)).not.toBeInTheDocument();
  });

  it('says so when it cannot load, and tries again', async () => {
    get.mockRejectedValueOnce(new Error('offline'));
    catalogueGet([mug]);
    get.mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your items');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Event mug' })).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>);
    mount();
    expect(screen.getByText('Sign in to manage the things you sell.')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('Things I sell: add and edit', () => {
  it('adds an item from the sheet, checks it first, and opens the new item', async () => {
    let saved = false;
    get.mockImplementation(async (url) => {
      if (url === '/commerce/catalogue') return { data: saved ? [mug] : [] } as never;
      if (url === '/commerce/listings/mine') return { data: [] } as never;
      return { data: { items: [AUTUMN], hasMore: false } } as never;
    });
    post.mockImplementation(async () => { saved = true; return { data: mug } as never; });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    expect(screen.getByRole('dialog', { name: 'Add an item' })).toBeInTheDocument();
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    expect(await dialog().findByRole('alert')).toHaveTextContent('Add a name and description, then check the price.');
    await userEvent.type(dialog().getByLabelText('Name'), 'Event mug');
    await userEvent.type(dialog().getByLabelText('Description'), 'Collect from the secretary’s tent.');
    await userEvent.type(dialog().getByLabelText('Price (£)'), '8.50');
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/catalogue', expect.objectContaining({ title: 'Event mug', priceMinor: 850, stockQuantity: null, category: 0, imageUrl: null })));
    expect(await screen.findByRole('heading', { name: 'Event mug' })).toBeInTheDocument();
    expect(screen.getByText('Autumn Games')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('starts from a stabling preset, keeping a price already typed', async () => {
    catalogueGet([]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await userEvent.type(dialog().getByLabelText('Price (£)'), '70');
    await userEvent.click(dialog().getByRole('combobox', { name: /^Start from/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Weekend stabling' }));
    expect(dialog().getByLabelText('Name')).toHaveValue('Weekend stabling');
    expect(dialog().getByLabelText('Price (£)')).toHaveValue(70);
    expect((dialog().getByLabelText('Description') as HTMLTextAreaElement).value).toContain('Temporary event stable box');
    expect(dialog().getByRole('combobox', { name: /^Category/ })).toHaveTextContent('Camping and stabling');
    expect(dialog().queryByText('Quick presets')).not.toBeInTheDocument();
  });

  it('fills the preset price when none was typed, and Blank leaves the fields alone', async () => {
    catalogueGet([]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await userEvent.click(dialog().getByRole('combobox', { name: /^Start from/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Electric hook-up' }));
    expect(dialog().getByLabelText('Price (£)')).toHaveValue(45);
    await userEvent.click(dialog().getByRole('combobox', { name: /^Start from/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Blank' }));
    expect(dialog().getByLabelText('Name')).toHaveValue('Electric hook-up');
  });

  it('sets stock with a round stepper where nothing means No limit', async () => {
    catalogueGet([]);
    post.mockResolvedValue({ data: { ...mug, id: 30 } } as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    const stepper = dialog().getByRole('group', { name: 'Stock' });
    expect(within(stepper).getByRole('status')).toHaveTextContent('No limit');
    expect(within(stepper).getByRole('button', { name: 'Less stock' })).toBeDisabled();
    await userEvent.click(within(stepper).getByRole('button', { name: 'More stock' }));
    await userEvent.click(within(stepper).getByRole('button', { name: 'More stock' }));
    expect(within(stepper).getByRole('status')).toHaveTextContent('2');
    await userEvent.click(within(stepper).getByRole('button', { name: 'Less stock' }));
    await userEvent.type(dialog().getByLabelText('Name'), 'Hay');
    await userEvent.type(dialog().getByLabelText('Description'), 'A bale.');
    await userEvent.type(dialog().getByLabelText('Price (£)'), '5');
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/catalogue', expect.objectContaining({ stockQuantity: 1, priceMinor: 500 })));
  });

  it('picks a category from a dropdown and sends an optional image link', async () => {
    catalogueGet([]);
    post.mockResolvedValue({ data: { ...mug, id: 30 } } as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await userEvent.type(dialog().getByLabelText('Name'), 'Ticket');
    await userEvent.type(dialog().getByLabelText('Description'), 'Entry.');
    await userEvent.type(dialog().getByLabelText('Price (£)'), '5');
    await userEvent.type(dialog().getByLabelText('Image link (optional)'), 'https://example.test/t.png');
    await userEvent.click(dialog().getByRole('combobox', { name: /^Category/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Tickets' }));
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/catalogue', expect.objectContaining({ category: 1, imageUrl: 'https://example.test/t.png' })));
  });

  it('keeps the sheet open with the reason when saving fails', async () => {
    catalogueGet([]);
    post.mockRejectedValue(new Error('offline'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await userEvent.type(dialog().getByLabelText('Name'), 'Event mug');
    await userEvent.type(dialog().getByLabelText('Description'), 'Collect.');
    await userEvent.type(dialog().getByLabelText('Price (£)'), '8.50');
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    expect(await dialog().findByText('Couldn’t save the item. Check your signal and try again.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add an item' })).toBeInTheDocument();
  });

  it('keeps the sheet open while its save request is pending', async () => {
    catalogueGet([]);
    const pending = deferred<{ data: Record<string, never> }>();
    post.mockReturnValue(pending.promise as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await userEvent.type(dialog().getByLabelText('Name'), 'Event mug');
    await userEvent.type(dialog().getByLabelText('Description'), 'Collect at the event.');
    await userEvent.type(dialog().getByLabelText('Price (£)'), '8.50');
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    expect(dialog().getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await act(async () => { pending.resolve({ data: {} }); await pending.promise; });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits the details with the version it loaded, and sends the new stock', async () => {
    catalogueGet([mug]);
    put.mockResolvedValue({ data: { ...mug, version: 8 } } as never);
    mount();
    await openItem('Event mug');
    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument();
    expect(dialog().getByLabelText('Name')).toHaveValue('Event mug');
    expect(dialog().getByLabelText('Price (£)')).toHaveValue(8.5);
    expect(dialog().queryByRole('combobox', { name: /^Start from/ })).not.toBeInTheDocument();
    expect(within(dialog().getByRole('group', { name: 'Stock' })).getByRole('status')).toHaveTextContent('10');
    await userEvent.click(within(dialog().getByRole('group', { name: 'Stock' })).getByRole('button', { name: 'More stock' }));
    await userEvent.click(dialog().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/catalogue/20', expect.objectContaining({ stockQuantity: 11, expectedVersion: 7, isActive: true })));
  });

  it('asks what to ask the buyer for, and sends the question and its hint with the item', async () => {
    catalogueGet([]);
    post.mockResolvedValue({ data: { ...mug, id: 30 } } as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await userEvent.type(dialog().getByLabelText('Name'), 'Shavings');
    await userEvent.type(dialog().getByLabelText('Description'), 'Delivered to your stable.');
    await userEvent.type(dialog().getByLabelText('Price (£)'), '10');
    expect(dialog().queryByLabelText(/^Hint/)).not.toBeInTheDocument();
    await userEvent.type(dialog().getByLabelText(/^Ask the buyer for/), ' Stable number ');
    await userEvent.type(dialog().getByLabelText(/^Hint/), 'e.g. B12');
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/catalogue', expect.objectContaining({ detailPrompt: 'Stable number', detailHint: 'e.g. B12' })));
  });

  it('sends nothing for the question when it is left empty', async () => {
    catalogueGet([]);
    post.mockResolvedValue({ data: { ...mug, id: 30 } } as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Add an item' }));
    await userEvent.type(dialog().getByLabelText('Name'), 'Programme');
    await userEvent.type(dialog().getByLabelText('Description'), 'Collect at the gate.');
    await userEvent.type(dialog().getByLabelText('Price (£)'), '5');
    await userEvent.click(dialog().getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/catalogue', expect.objectContaining({ detailPrompt: null, detailHint: null })));
  });

  it('opens an item with its question filled in, and keeps it when the item is edited or brought back', async () => {
    const asking = { ...mug, detailPrompt: 'Number plate', detailHint: 'e.g. AB12 CDE' };
    catalogueGet([asking]);
    put.mockResolvedValue({ data: { ...asking, version: 8 } } as never);
    const view = mount();
    await openItem('Event mug');
    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(dialog().getByLabelText(/^Ask the buyer for/)).toHaveValue('Number plate');
    expect(dialog().getByLabelText(/^Hint/)).toHaveValue('e.g. AB12 CDE');
    await userEvent.clear(dialog().getByLabelText(/^Hint/));
    await userEvent.click(dialog().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/catalogue/20', expect.objectContaining({ detailPrompt: 'Number plate', detailHint: null })));

    // Bringing an archived item back sends the question too, so it isn't wiped.
    view.unmount();
    catalogueGet([{ ...asking, isActive: false }]);
    mount();
    await openItem('Event mug');
    await userEvent.click(screen.getByRole('button', { name: 'Bring it back' }));
    await waitFor(() => expect(put).toHaveBeenLastCalledWith('/commerce/catalogue/20', expect.objectContaining({ isActive: true, detailPrompt: 'Number plate', detailHint: 'e.g. AB12 CDE' })));
  });

  it('keeps a sold-out item sold out unless the stepper is used', async () => {
    catalogueGet([{ ...mug, stockQuantity: 0 }]);
    put.mockResolvedValue({ data: mug } as never);
    mount();
    await openItem('Event mug');
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(within(dialog().getByRole('group', { name: 'Stock' })).getByRole('status')).toHaveTextContent('Sold out');
    await userEvent.click(dialog().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/catalogue/20', expect.objectContaining({ stockQuantity: 0 })));
  });
});

describe('Things I sell: an item', () => {
  it('shows the price, category and stock, then its events with a chip for each', async () => {
    catalogueGet(
      [{ ...mug, category: 2, stockQuantity: null }],
      [listingOf(1, 20, 1, 5), listingOf(2, 20, 0, 6), listingOf(3, 20, 2, 7, 'Only stabling here.'), listingOf(4, 20, 3, 8)],
      [AUTUMN, WINTER, { id: 7, name: 'Spring Open', startDate: '2027-03-01' }, { id: 8, name: 'Summer Show', startDate: '2027-06-01' }, { id: 9, name: 'Zone Champs', startDate: '2027-09-01' }],
    );
    mount();
    await openItem('Event mug');
    expect(screen.getByRole('heading', { name: 'Event mug' })).toBeInTheDocument();
    const details = screen.getByRole('heading', { name: 'Details' }).nextElementSibling as HTMLElement;
    expect(details).toHaveTextContent('Price£8.50');
    expect(details).toHaveTextContent('CategoryCamping and stabling');
    expect(details).toHaveTextContent('StockNo limit');
    expect(within(eventRow('Autumn Games')).getByText('On sale')).toBeInTheDocument();
    expect(within(eventRow('Winter Games')).getByText('Waiting')).toBeInTheDocument();
    expect(within(eventRow('Spring Open')).getByText('Declined')).toBeInTheDocument();
    expect(within(eventRow('Summer Show')).getByText('Withdrawn')).toBeInTheDocument();
    expect(within(eventRow('Zone Champs')).getByText('Not offered')).toBeInTheDocument();
    expect(within(eventRow('Spring Open')).getByText('Organiser: Only stabling here.')).toHaveClass('cs-note-red');
    // Withdraw only on waiting rows; Offer here on rows that are not on offer.
    expect(within(eventRow('Winter Games')).getByRole('button', { name: 'Withdraw from Winter Games' })).toHaveClass('kit-redtext');
    expect(within(eventRow('Autumn Games')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(eventRow('Zone Champs')).getByRole('button', { name: 'Offer at Zone Champs' })).toHaveClass('kit-pill');
    expect(screen.queryByText(/Changing the price/)).not.toBeInTheDocument();
    expect(screen.queryByText(/organiser approves items/)).not.toBeInTheDocument();
  });

  it('opens the item from the address, and shows stock left', async () => {
    catalogueGet([mug]);
    mount('/me/catalogue?item=20');
    expect(await screen.findByRole('heading', { name: 'Event mug' })).toBeInTheDocument();
    expect(screen.getByText('10 left')).toBeInTheDocument();
  });

  it('offers the item at an event with the Offer here pill', async () => {
    catalogueGet([mug], [], [AUTUMN, WINTER]);
    post.mockResolvedValue({ data: {} } as never);
    mount();
    await openItem('Event mug');
    await userEvent.click(screen.getByRole('button', { name: 'Offer at Winter Games' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/6/listings', { catalogueItemId: 20 }));
  });

  it('lets a seller ask again at an event that declined or withdrew the item', async () => {
    catalogueGet([mug], [listingOf(1, 20, 2, 5, 'Food only.'), listingOf(2, 20, 3, 6)], [AUTUMN, WINTER]);
    post.mockResolvedValue({ data: {} } as never);
    mount();
    await openItem('Event mug');
    expect(screen.getByText('Organiser: Food only.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Offer at Autumn Games' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/5/listings', { catalogueItemId: 20 }));
    await userEvent.click(screen.getByRole('button', { name: 'Offer at Winter Games' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/6/listings', { catalogueItemId: 20 }));
  });

  it('says so when it cannot offer the item', async () => {
    catalogueGet([mug], [], [AUTUMN]);
    post.mockRejectedValue(new Error('offline'));
    mount();
    await openItem('Event mug');
    await userEvent.click(screen.getByRole('button', { name: 'Offer at Autumn Games' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t offer this at Autumn Games. Check your signal and try again.');
  });

  it('withdraws a waiting listing after asking', async () => {
    catalogueGet([mug], [listingOf(1, 20, 0, 5)]);
    const asked = autoConfirm([false, true]);
    mount();
    await openItem('Event mug');
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw from Autumn Games' }));
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Buyers stop seeing it in the shop.'));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw from Autumn Games' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/commerce/listings/1'));
  });

  it('names an event it does not know by its number, and says when there are no events', async () => {
    catalogueGet([mug], [listingOf(1, 20, 1, 99)], []);
    mount();
    await openItem('Event mug');
    expect(screen.getByText('Event 99')).toBeInTheDocument();
  });

  it('says so when there are no upcoming events at all', async () => {
    catalogueGet([mug], [], []);
    mount();
    await openItem('Event mug');
    expect(screen.getByText('No upcoming events.')).toBeInTheDocument();
  });

  it('archives with red text after asking, and brings an archived item back', async () => {
    catalogueGet([mug]);
    const asked = autoConfirm([false, true]);
    mount();
    await openItem('Event mug');
    const archive = screen.getByRole('button', { name: 'Archive this item' });
    expect(archive).toHaveClass('kit-redtext');
    await userEvent.click(archive);
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Event mug is hidden from your items. You can bring it back later.'));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Archive this item' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/commerce/catalogue/20'));
  });

  it('brings an archived item back, and offers it nowhere while archived', async () => {
    catalogueGet([{ ...mug, isActive: false }], [], [AUTUMN]);
    put.mockResolvedValue({ data: mug } as never);
    mount();
    await openItem('Event mug');
    expect(screen.queryByRole('button', { name: 'Offer at Autumn Games' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bring it back' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/commerce/catalogue/20', expect.objectContaining({ isActive: true, expectedVersion: 7, title: 'Event mug' })));
  });

  it('says so when it cannot archive', async () => {
    catalogueGet([mug]);
    autoConfirm(true);
    del.mockRejectedValue(new Error('offline'));
    mount();
    await openItem('Event mug');
    await userEvent.click(screen.getByRole('button', { name: 'Archive this item' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t archive the item. Check your signal and try again.');
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
    mount();
    await openItem('Event mug');
    expect(screen.getByText('First event')).toBeInTheDocument();
    expect(screen.getByText('Later event')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/competitions/picker', { params: { past: false, page: 1, pageSize: 50 } });
    expect(get).toHaveBeenCalledWith('/competitions/picker', { params: { past: false, page: 2, pageSize: 50 } });
    await userEvent.click(screen.getByRole('button', { name: 'Offer at Later event' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/commerce/competitions/6/listings', { catalogueItemId: 20 }));
  });

  it('falls back to the list when the item in the address is not yours', async () => {
    catalogueGet([mug]);
    mount('/me/catalogue?item=999');
    expect(await screen.findByRole('button', { name: 'Event mug' })).toBeInTheDocument();
  });
});
