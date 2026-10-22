import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type StoredAuth } from '../../api';
import { AuthProvider } from '../../auth/AuthContext';
import { NeedsYouProvider } from './NeedsYouProvider';
import { useNeedsYou, type NeedsYouValue } from './needsYou';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

const request = { userId: 'a b', fullName: 'Sam Lee', email: 'sam@example.com', clubName: null, requestedAt: '2026-10-20T09:00:00Z' };
const latest: { value: NeedsYouValue | null } = { value: null };
const seen = () => latest.value!;

function Probe() {
  const value = useNeedsYou();
  useEffect(() => { latest.value = value; });
  return <span data-testid="count">{value.count}</span>;
}

function mount(roles: string[] | null) {
  if (roles) {
    const auth: StoredAuth = {
      token: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'u1', email: 'a@example.com', fullName: 'A', clubId: null, clubName: null, roles },
    };
    localStorage.setItem('mg.auth', JSON.stringify(auth));
  }
  return render(<AuthProvider><NeedsYouProvider><Probe /></NeedsYouProvider></AuthProvider>);
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/admin/trainer-requests' ? [request] : url === '/competitions/access' ? [] : {} }));
  vi.mocked(api.post).mockResolvedValue({ data: {} });
});

describe('NeedsYouProvider', () => {
  it('counts the trainer requests an admin has to look at', async () => {
    mount(['Admin']);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    expect(seen().requests).toEqual([request]);
  });

  it('asks nothing of anyone else', () => {
    mount(['Trainer']);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(api.get).not.toHaveBeenCalledWith('/admin/trainer-requests');
  });

  it('asks nothing of a visitor', () => {
    mount(null);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(api.get).not.toHaveBeenCalledWith('/admin/trainer-requests');
  });

  it('stays at zero if the list cannot be loaded or is not a list', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/admin/trainer-requests') return { data: '<html>' };
      return { data: url === '/competitions/access' ? [] : {} };
    });
    mount(['Admin']);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/trainer-requests'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('survives a failed request', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/admin/trainer-requests') throw new Error('offline');
      return { data: url === '/competitions/access' ? [] : {} };
    });
    mount(['Admin']);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/trainer-requests'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('removes a request once it has been approved, escaping the id in the URL', async () => {
    mount(['Admin']);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    let ok = false;
    await act(async () => { ok = await seen().review(request, 'approve'); });
    expect(ok).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/admin/trainer-requests/a%20b/approve');
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('keeps a request when the server refuses', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('no'));
    mount(['Admin']);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    let ok = true;
    await act(async () => { ok = await seen().review(request, 'decline'); });
    expect(ok).toBe(false);
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  it('does nothing when used outside the provider', async () => {
    render(<Probe />);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(await seen().review(request, 'approve')).toBe(false);
  });
});
