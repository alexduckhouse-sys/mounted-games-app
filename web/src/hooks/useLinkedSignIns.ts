import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { SocialCredential } from '../components/SocialLoginButtons';
import type { LinkedSignIns } from '../types';

function isLinkedSignIns(data: unknown): data is LinkedSignIns {
  const d = data as Partial<LinkedSignIns> | null;
  return Boolean(d && typeof d === 'object' && typeof d.hasPassword === 'boolean' && Array.isArray(d.logins)
    && d.logins.every((l) => l && typeof l.provider === 'string' && typeof l.name === 'string'));
}

export interface LinkedSignInsState {
  /** Null while loading, or if it couldn't be fetched. */
  info: LinkedSignIns | null;
  /** Adds a provider to the signed-in account (`POST /auth/logins`). Throws the API's error. */
  connect: (credential: SocialCredential) => Promise<void>;
  /** Removes one (`DELETE /auth/logins/:provider`). Throws the API's error, e.g. for the last way in. */
  remove: (provider: string) => Promise<void>;
}

/** How the signed-in person can sign in (`GET /auth/logins`): whether there's a password, and which providers are linked. */
export function useLinkedSignIns(): LinkedSignInsState {
  const [info, setInfo] = useState<LinkedSignIns | null>(null);

  useEffect(() => {
    let live = true;
    api.get<unknown>('/auth/logins')
      .then(({ data }) => { if (live && isLinkedSignIns(data)) setInfo(data); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const connect = useCallback(async ({ provider, idToken, nonce }: SocialCredential) => {
    const { data } = await api.post<unknown>('/auth/logins', { provider, idToken, nonce });
    if (isLinkedSignIns(data)) setInfo(data);
  }, []);

  const remove = useCallback(async (provider: string) => {
    const { data } = await api.delete<unknown>(`/auth/logins/${encodeURIComponent(provider)}`);
    if (isLinkedSignIns(data)) setInfo(data);
  }, []);

  return { info, connect, remove };
}
