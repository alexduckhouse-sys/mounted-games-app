import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import { competition } from '../../test/factories';
import type { CompetitionSection, SectionSignup } from '../../types';
import { CompetitionContext, type CompetitionCtx } from './context';
import { DetailsTab } from './DetailsTab';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../commerce/DemoEntryPayment', () => ({ DemoEntryPayment: () => null }));

const section: CompetitionSection = { id: 5, competitionId: 1, format: 1, ageGroup: 'U12', displayName: 'Under 12', priceMinor: 1500 };

function signup(extra: Partial<SectionSignup> = {}): SectionSignup {
  return {
    id: 9, competitionSectionId: 5, sectionName: 'Under 12', fullName: 'Alice Rider', amountMinor: 1500,
    status: 0, createdAt: '2026-10-22T10:00:00Z', ...extra,
  };
}

function mount(roles: string[] = ['Member'], userId = 'u1') {
  localStorage.setItem('mg.auth', JSON.stringify({
    token: 'test-token', expiresAt: '2099-01-01T00:00:00Z',
    user: { id: userId, fullName: 'Test Person', email: 'test@example.com', roles },
  }));
  const ctx = { competition: competition({ sections: [section], createdByUserId: 'owner' }), reload: vi.fn() } as unknown as CompetitionCtx;
  return render(
    <AuthProvider><MemoryRouter><CompetitionContext.Provider value={ctx}><DetailsTab /></CompetitionContext.Provider></MemoryRouter></AuthProvider>,
  );
}

async function openForm() {
  await userEvent.click(await screen.findByRole('button', { name: /Join/ }));
  await userEvent.type(screen.getByLabelText('Your full name'), 'Alice Rider');
  await userEvent.click(screen.getByRole('checkbox', { name: /parental consent/ }));
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url) => (url === '/auth/me' ? { data: { roles: ['Member'] } } : { data: [] }));
  vi.mocked(api.post).mockResolvedValue({ data: signup() });
});

describe('sign-up form email', () => {
  it('sends no email, no opt-in and a request id when the address is left blank', async () => {
    mount();
    await openForm();
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body).toMatchObject({ fullName: 'Alice Rider', contactEmail: null, emailOptIn: false, emailOptInVersion: null });
    expect(typeof body.requestId).toBe('string');
  });

  it('sends the address, and the opt-in only when the box is ticked', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: signup({ confirmationEmailStatus: 1 }) });
    mount();
    await openForm();
    await userEvent.type(screen.getByLabelText(/Your email/), 'parent@example.org');
    expect((screen.getByLabelText(/Email me when new competitions open/) as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByLabelText(/Email me when new competitions open/));
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({
      contactEmail: 'parent@example.org', emailOptIn: true, emailOptInVersion: 'alerts-2026-10-22',
    });
    expect((await screen.findByRole('status')).textContent).toMatch(/emailed you a confirmation/);
  });

  it('reuses the request id when the same attempt is retried after a failure', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: signup() });
    mount();
    await openForm();
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const ids = vi.mocked(api.post).mock.calls.map((c) => (c[1] as { requestId: string }).requestId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('does not send a malformed address', async () => {
    mount();
    await openForm();
    await userEvent.type(screen.getByLabelText(/Your email/), 'parent@');
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));

    expect(api.post).not.toHaveBeenCalled();
    expect((await screen.findAllByRole('alert'))[0].textContent).toMatch(/doesn't look right/);
  });

  it('says plainly when the confirmation email could not be sent', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: signup({ confirmationEmailStatus: 2 }) });
    mount();
    await openForm();
    await userEvent.type(screen.getByLabelText(/Your email/), 'parent@example.org');
    await userEvent.click(screen.getByRole('button', { name: /Confirm/ }));

    expect((await screen.findByRole('status')).textContent).toMatch(/couldn't send the confirmation email, but your entry is saved/);
  });
});

describe('organiser list', () => {
  it('shows the address and what happened to the confirmation', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/auth/me') return { data: { roles: ['Admin'] } };
      if (String(url).endsWith('/signups')) return { data: [signup({ contactEmail: 'parent@example.org', confirmationEmailStatus: 2 }), signup({ id: 10, fullName: 'Bob' })] };
      return { data: [] };
    });
    mount(['Admin'], 'admin1');

    expect(await screen.findByText(/parent@example.org · Confirmation email failed/)).toBeTruthy();
    expect(screen.getByText('No email address')).toBeTruthy();
  });
});
