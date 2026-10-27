import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import { LanguageProvider } from '../../i18n/LanguageContext';
import type { Lang } from '../../i18n/translate';
import { LoginPage } from '../LoginPage';
import { SignUpPage } from '../SignUpPage';
import { InvitePage } from '../InvitePage';
import { PasswordChecklist } from '../../components/PasswordChecklist';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

function mount(lang: Lang, page: 'login' | 'signup' | 'invite') {
  return render(
    <LanguageProvider initial={lang}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/${page}`]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/invite" element={<InvitePage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: [{ id: 1, name: 'Stockport Mounted Games' }] });
});

describe.each([
  { lang: 'cy' as const, signIn: 'Mewngofnodi', email: 'E-bost', password: 'Cyfrinair', create: 'Creu cyfrif', show: 'Dangos y cyfrinair' },
  { lang: 'fr' as const, signIn: 'Se connecter', email: 'E-mail', password: 'Mot de passe', create: 'Créer un compte', show: 'Afficher le mot de passe' },
])('sign in and sign up in $lang', ({ lang, signIn, email, password, create, show }) => {
  it('translates the sign in page', () => {
    mount(lang, 'login');
    expect(screen.getByRole('heading', { name: signIn })).toBeInTheDocument();
    expect(screen.getByLabelText(email)).toBeInTheDocument();
    expect(screen.getByLabelText(password)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: show })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: create })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe(lang);
  });

  it('translates the organiser key view', async () => {
    mount(lang, 'login');
    await userEvent.click(screen.getByRole('button', { name: /Trefnydd ag allwedd|Organisateur avec une clé/ }));
    expect(screen.getByLabelText(/Allwedd trefnydd|Clé organisateur/)).toBeInTheDocument();
  });

  it('translates the sign up page and leaves club names as typed', async () => {
    mount(lang, 'signup');
    expect(screen.getByRole('heading', { name: create })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(lang === 'cy' ? 'Enw’r clwb / tîm' : 'Nom du club / de l’équipe'), 'Stockport');
    expect(await screen.findByRole('button', { name: 'Stockport Mounted Games' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stockport Mounted Games' }));
    await userEvent.click(screen.getByRole('radio', { name: lang === 'cy' ? 'Hyfforddwr' : 'Entraîneur' }));
    expect(screen.getByText(lang === 'cy' ? 'Cymeradwywyd gan reolwr tîm Stockport Mounted Games.' : 'Approuvé par le responsable d’équipe de Stockport Mounted Games.')).toBeInTheDocument();
  });

  it('translates the invitation page when the link is missing', () => {
    mount(lang, 'invite');
    expect(screen.getByRole('heading', { name: lang === 'cy' ? 'Gwahoddiad' : 'Invitation' })).toBeInTheDocument();
    expect(screen.getByText(lang === 'cy' ? /wedi dod i ben/ : /a expiré/)).toBeInTheDocument();
  });
});

describe('the password checklist', () => {
  it('names the next rule in the language in use', () => {
    render(<LanguageProvider initial="cy"><PasswordChecklist password="a" id="rules" /></LanguageProvider>);
    expect(screen.getAllByText(/O leiaf 8 nod/).length).toBeGreaterThan(0);
  });

  it('ticks off every rule in French', () => {
    render(<LanguageProvider initial="fr"><PasswordChecklist password="abcdef1!" id="rules" /></LanguageProvider>);
    expect(screen.getAllByText(/Le mot de passe remplit toutes les exigences/).length).toBeGreaterThan(0);
  });
});
