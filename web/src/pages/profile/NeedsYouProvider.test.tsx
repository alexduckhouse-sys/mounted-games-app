import { useLayoutEffect } from 'react';
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
  // A layout effect runs in the same commit that updates the DOM, so once waitFor sees the count, seen() matches it.
  useLayoutEffect(() => { latest.value = value; });
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

  it('counts a team manager\'s club requests too', async () => {
    mount(['Manager']);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    expect(api.get).toHaveBeenCalledWith('/admin/trainer-requests');
  });

  it('asks nobody else for join requests', () => {
    mount(['Trainer']);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(api.get).not.toHaveBeenCalledWith('/admin/trainer-requests');
  });

  it('counts the dec forms still to fill in, from the teams the person looks after', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: url === '/trainer/my-teams'
        ? [{ id: 1, needsDeclaration: true }, { id: 2, needsDeclaration: false }, { id: 3 }, { id: 4, needsDeclaration: true }]
        : url === '/competitions/access' ? [] : {},
    }));
    mount(['Trainer']);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    expect(seen().decForms.map((t) => t.id)).toEqual([1, 4]);
    expect(seen().teams).toHaveLength(4);
  });

  it('adds the dec forms to the join requests', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: url === '/admin/trainer-requests' ? [request] : url === '/trainer/my-teams' ? [{ id: 1, needsDeclaration: true }] : url === '/competitions/access' ? [] : {},
    }));
    mount(['Admin']);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
  });

  it('keeps the teams unset when they cannot be loaded', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/trainer/my-teams') throw new Error('offline');
      return { data: url === '/competitions/access' ? [] : {} };
    });
    mount(['Trainer']);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/trainer/my-teams'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(seen().teams).toBeNull();
  });

  it('asks nothing of a visitor', () => {
    mount(null);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(api.get).not.toHaveBeenCalledWith('/admin/trainer-requests');
    expect(api.get).not.toHaveBeenCalledWith('/trainer/my-teams');
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

  it('keeps the server\'s message for the failure, and clears it on the next try', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({ response: { status: 409, data: { message: 'Could not approve this request. Refresh the list and try again.' } } });
    mount(['Admin']);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    await act(async () => { await seen().review(request, 'approve'); });
    expect(seen().reviewError).toBe('Could not approve this request. Refresh the list and try again.');
    await act(async () => { await seen().review(request, 'approve'); });
    expect(seen().reviewError).toBeNull();
  });

  it('does nothing when used outside the provider', async () => {
    render(<Probe />);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(await seen().review(request, 'approve')).toBe(false);
  });

  it('removes a request when notified via mg:trainer-requests-changed', async () => {
    mount(['Admin']);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    act(() => {
      window.dispatchEvent(new CustomEvent('mg:trainer-requests-changed', { detail: {} }));
    });
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    act(() => {
      window.dispatchEvent(new CustomEvent('mg:trainer-requests-changed', { detail: { userId: request.userId } }));
    });
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});
