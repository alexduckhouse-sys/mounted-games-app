import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type { TrainerRequest } from '../../types';
import { NeedsYouContext, type NeedsYouValue } from './needsYou';

const NONE: TrainerRequest[] = [];

/**
 * What is waiting on the signed-in person, shared by the Me tab's badge and the profile page.
 * Today that is trainer requests for admins. Club approvals and missing dec forms need API work
 * that is still to come (BUG-14), so they are not here yet.
 */
export function NeedsYouProvider({ children }: { children: ReactNode }) {
  const { user, hasRole } = useAuth();
  const userId = user?.id ?? null;
  const isAdmin = hasRole('Admin');
  // Remember whose list this is, so one person's requests are never shown to the next.
  const [loaded, setLoaded] = useState<{ userId: string; requests: TrainerRequest[] } | null>(null);

  useEffect(() => {
    if (!isAdmin || !userId) return;
    let cancelled = false;
    api.get<TrainerRequest[]>('/admin/trainer-requests').then(({ data }) => {
      if (!cancelled && Array.isArray(data)) setLoaded({ userId, requests: data });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAdmin, userId]);

  const requests = isAdmin && loaded && loaded.userId === userId ? loaded.requests : NONE;

  const review = useCallback(async (request: TrainerRequest, action: 'approve' | 'decline') => {
    try {
      await api.post(`/admin/trainer-requests/${encodeURIComponent(request.userId)}/${action}`);
    } catch {
      return false;
    }
    setLoaded((cur) => (cur ? { ...cur, requests: cur.requests.filter((r) => r.userId !== request.userId) } : cur));
    return true;
  }, []);

  const value = useMemo<NeedsYouValue>(() => ({ requests, count: requests.length, review }), [requests, review]);
  return <NeedsYouContext.Provider value={value}>{children}</NeedsYouContext.Provider>;
}
