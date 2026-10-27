import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/translate';
import { AccountPage } from './AccountPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

function mount(lang: Lang) {
  const auth: StoredAuth = {
    token: 't', expiresAt: '2099-01-01T00:00:00Z',
    user: { id: 'u1', fullName: 'Jamie Carter', email: 'jamie@example.com', clubId: 7, clubName: 'Warwickshire Hunt', roles: ['Trainer'] },
  };
  localStorage.setItem('mg.auth', JSON.stringify(auth));
  return render(
    <LanguageProvider initial={lang}>
      <MemoryRouter initialEntries={['/me/account']}>
        <AuthProvider>
          <Routes><Route path="/me/account" element={<AccountPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: { id: 'u1', fullName: 'Jamie Carter', email: 'jamie@example.com', clubId: 7, clubName: 'Warwickshire Hunt', roles: ['Trainer'] } });
});

describe.each([
  { lang: 'cy' as const, name: 'Enw', role: 'Hyfforddwr', password: 'Cyfrinair', del: 'Dileu fy nghyfrif' },
  { lang: 'fr' as const, name: 'Nom', role: 'Entraîneur', password: 'Mot de passe', del: 'Supprimer mon compte' },
])('My account in $lang', ({ lang, name, role, password, del }) => {
  it('translates the row labels and the role, and leaves the person and club as they are', () => {
    mount(lang);
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText(role)).toBeInTheDocument();
    expect(screen.getByText(password)).toBeInTheDocument();
    expect(screen.getByText('Jamie Carter')).toBeInTheDocument();
    expect(screen.getByText('Warwickshire Hunt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: del })).toBeInTheDocument();
  });
});
