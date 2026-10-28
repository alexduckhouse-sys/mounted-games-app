import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/translate';
import { ShopPage } from './ShopPage';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: null, canEdit: () => false }) }));

const post = { id: 1, authorName: 'Sam', ponyClubName: 'Stockport', title: 'Grey saddle', body: 'Barely used', priceMinor: 12000, contactInfo: null, createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), isDeleted: false, commentCount: 0, reportCount: 0, authorUserId: 'seller' };

function mount(lang: Lang) {
  return render(<LanguageProvider initial={lang}><MemoryRouter><ShopPage /></MemoryRouter></LanguageProvider>);
}

describe('Shop in Welsh and French', () => {
  beforeEach(() => { vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/shop/posts' ? [post] : [] })); });

  it('reads in French, leaving the seller’s own words alone', async () => {
    mount('fr');
    const row = await screen.findByRole('button', { name: /Grey saddle/ });
    expect(row).toHaveTextContent('il y a 3 jours');
    expect(screen.getByRole('button', { name: 'Sellerie et équipement' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vendre quelque chose' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtrer la boutique' })).toBeInTheDocument();
  });

  it('reads in Welsh', async () => {
    mount('cy');
    expect(await screen.findByRole('button', { name: /Grey saddle/ })).toHaveTextContent('3 diwrnod yn ôl');
    expect(screen.getByRole('button', { name: 'Siopau digwyddiadau' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gwerthu rhywbeth' })).toBeInTheDocument();
  });
});
