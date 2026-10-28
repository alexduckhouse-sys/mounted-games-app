import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { setActiveLang, type Lang } from '../../i18n/translate';
import { DRAFT_KEY } from './emailDraft';
import { EmailPage } from './EmailPage';
import { lastRunText, nextSendText } from './entriesDigestText';
import type { EntriesDigestStatus } from './entriesDigestTypes';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const digest: EntriesDigestStatus = {
  canSend: true, cannotSendBecause: null, recipients: 12, pendingCount: 2,
  pending: [{ id: 1, name: 'Spring Cup', startDate: '2026-11-07T09:00:00Z', location: null }, { id: 2, name: 'Autumn Open', startDate: '2026-11-14T09:00:00Z', location: null }],
  last: null, todayClaimed: false, nextSendUtc: '2099-01-01T18:00:00Z',
};

function mount(lang: Lang) {
  return render(<LanguageProvider initial={lang}><MemoryRouter><EmailPage /></MemoryRouter></LanguageProvider>);
}

describe('EmailPage in other languages', () => {
  beforeEach(() => {
    window.localStorage.removeItem(DRAFT_KEY);
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/admin/custom-emails/audiences') return { data: [{ audience: 0, label: 'x', recipients: 3 }, { audience: 1, label: 'x', recipients: 64 }] } as never;
      if (url === '/admin/entries-digest') return { data: digest } as never;
      if (url === '/admin/custom-emails') return { data: [{ id: 3, subject: 'Autumn dates', audience: 0, status: 1, total: 412, sent: 410, failed: 2, skipped: 0, remaining: 0, createdAt: '2026-10-25T10:00:00Z', completedAt: null, createdByName: null }] } as never;
      return { data: [] } as never;
    });
  });
  afterEach(() => setActiveLang('en'));

  it('shows the composer, the sent list and the new-event card in French', async () => {
    mount('fr');
    expect(screen.getByRole('heading', { level: 1, name: 'E-mail' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'À: Liste d’actualités · 3' })).toBeInTheDocument();
    expect(screen.getByLabelText('Objet')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter un lien' })).toBeInTheDocument();
    expect(await screen.findByText(/410 envoyés · 2 n’ont pas abouti/)).toBeInTheDocument();
    expect(await screen.findByText('2 compétitions : Spring Cup, Autumn Open')).toBeInTheDocument();
    expect(screen.getByText('12 personnes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoyer maintenant' })).toBeInTheDocument();
    expect(screen.queryByText('Add a link')).not.toBeInTheDocument();
    expect(screen.queryByText('Send now')).not.toBeInTheDocument();
  });

  it('shows the composer in Welsh', async () => {
    mount('cy');
    expect(screen.getByRole('heading', { level: 1, name: 'E-bost' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'At: Rhestr newyddion · 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ychwanegu dolen' })).toBeInTheDocument();
    expect(screen.queryByText('Add a link')).not.toBeInTheDocument();
  });

  it('words the digest status lines in the language in use', () => {
    setActiveLang('fr');
    expect(nextSendText('2099-01-01T18:00:00Z', new Date('2098-12-31T09:00:00Z'))).toBe('Demain soir, vers 18 h');
    expect(lastRunText({ id: 1, runDate: '2026-10-24', status: 1, manual: false, competitions: 2, total: 12, sent: 11, failed: 1, skipped: 0, remaining: 0, claimedAt: '2026-10-24T17:00:00Z', completedAt: null })).toMatch(/11 envoyés, 1 n’ont pas abouti\.$/);
  });
});
