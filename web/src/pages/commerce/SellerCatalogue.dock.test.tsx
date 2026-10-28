import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { TickerProvider, useDockHost, useTicker } from '../../components/TickerContext';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { SellerCataloguePage } from './SellerCataloguePage';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

const mug = {
  id: 20, title: 'Event mug', description: 'Collect at the event.', priceMinor: 850, currency: 'GBP' as const,
  stockQuantity: 10, category: 0 as const, imageUrl: null, isActive: true, version: 7,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};
const listing = (status: 0 | 1 | 2 | 3) => ({ id: 1, competitionId: 5, catalogueItemId: 20, sellerUserId: 's', status, reviewNote: null, reviewedAt: null, item: mug, createdAt: '', updatedAt: '' });

function Probe() {
  useDockHost();
  const { dockAction } = useTicker();
  return dockAction ? <button type="button" data-testid="dock" onClick={dockAction.onClick}>{dockAction.label}</button> : null;
}

const mount = (path: string, lang: Lang = 'en', docked = true) => render(
  <LanguageProvider initial={lang}>
    <MemoryRouter initialEntries={[path]}>
      {docked ? <TickerProvider><SellerCataloguePage /><Probe /></TickerProvider> : <SellerCataloguePage />}
    </MemoryRouter>
  </LanguageProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { id: 's', fullName: 'Seller' } } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/commerce/catalogue') return { data: [mug] } as never;
    if (url === '/commerce/listings/mine') return { data: [listing(0)] } as never;
    return { data: { items: [{ id: 5, name: 'Autumn Games', startDate: '2026-10-20' }], hasMore: false } } as never;
  });
});

describe('Add an item beside the ticker dock', () => {
  it('moves the add bar to the dock and opens the sheet from there', async () => {
    mount('/me/catalogue');
    await screen.findByRole('button', { name: 'Event mug' });
    expect(document.querySelector('.cs-addbar')).toBeNull();
    await userEvent.click(screen.getByTestId('dock'));
    expect(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
  });

  it('keeps the add bar when there is no dock', async () => {
    mount('/me/catalogue', 'en', false);
    expect(await screen.findByRole('button', { name: 'Add an item' })).toHaveClass('cs-addbar');
  });

  it('has no dock button on an item’s own page', async () => {
    mount('/me/catalogue?item=20');
    await screen.findByText('Details');
    expect(screen.queryByTestId('dock')).toBeNull();
  });
});

describe('Things I sell in Welsh and French', () => {
  it('reads the list in French', async () => {
    mount('/me/catalogue', 'fr', false);
    const row = await screen.findByRole('button', { name: 'Event mug' });
    expect(row).toHaveTextContent('1 événement · 1 en attente');
    expect(screen.getByText('Vos articles')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter un article' })).toBeInTheDocument();
  });

  it('reads an item’s page in Welsh, with the date in the active language', async () => {
    mount('/me/catalogue?item=20', 'cy', false);
    expect(await screen.findByText('Manylion')).toBeInTheDocument();
    expect(screen.getByText('Digwyddiadau')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tynnu’n ôl o Autumn Games' })).toBeInTheDocument();
    expect(screen.getByText('Yn aros')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Golygu’r manylion' })).toBeInTheDocument();
  });

  it('opens the add sheet in French', async () => {
    mount('/me/catalogue', 'fr', false);
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un article' }));
    const sheet = within(screen.getByRole('dialog'));
    expect(sheet.getByText('Partir de')).toBeInTheDocument();
    expect(sheet.getByRole('textbox', { name: 'Nom' })).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Moins de stock' })).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Ajouter les options' })).toBeInTheDocument();
  });
});
