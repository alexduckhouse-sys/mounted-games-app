import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { AdminUser } from './accountAccessTypes';

/**
 * Looks accounts up by name or email (`GET /admin/users?q=`) a moment after the person stops typing.
 * `results` is null until something is typed, and `failed` is set when the lookup couldn't be made.
 */
export function useAccountSearch(query: string) {
  const [found, setFound] = useState<{ q: string; users: AdminUser[]; failed: boolean } | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.get<AdminUser[]>('/admin/users', { params: { q } })
        .then(({ data }) => { if (!cancelled) setFound({ q, users: Array.isArray(data) ? data : [], failed: false }); })
        .catch(() => { if (!cancelled) setFound({ q, users: [], failed: true }); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [q]);

  const current = q && found?.q === q ? found : null;
  return {
    /** Null while nothing is typed or the answer for what's typed hasn't arrived. */
    results: current?.users ?? null,
    failed: current?.failed ?? false,
    searching: !!q && !current,
    /** Changes one result in place after an action on it. */
    patch: (id: string, change: Partial<AdminUser>) => setFound((now) => (now ? { ...now, users: now.users.map((u) => (u.id === id ? { ...u, ...change } : u)) } : now)),
  };
}
