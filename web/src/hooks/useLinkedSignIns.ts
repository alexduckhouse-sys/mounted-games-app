import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { SocialCredential } from '../components/SocialLoginButtons';
import type { AuthResponse, LinkedSignIns } from '../types';

function isLinkedSignIns(data: unknown): data is LinkedSignIns {
  const d = data as Partial<LinkedSignIns> | null;
  return Boolean(d && typeof d === 'object' && typeof d.hasPassword === 'boolean' && Array.isArray(d.logins)
    && d.logins.every((l) => l && typeof l.provider === 'string' && typeof l.name === 'string'));
}

function isAuth(data: unknown): data is AuthResponse {
  const d = data as Partial<AuthResponse> | null | undefined;
  return Boolean(d && typeof d === 'object' && typeof d.token === 'string' && d.user && typeof d.user === 'object');
}

/**
 * Proof that the owner is here, which the API needs before it adds or removes a way to sign in: the current password,
 * or for an account without one a fresh sign-in with a provider it already has.
 */
export type SignInProof = { password: string } | { provider: string; idToken: string; nonce?: string };

export interface LinkedSignInsState {
  /** Null while loading, or if it couldn't be fetched. */
  info: LinkedSignIns | null;
  /** Adds a provider to the signed-in account (`POST /auth/logins`). Throws the API's error. */
  connect: (credential: SocialCredential, proof: SignInProof) => Promise<void>;
  /** Removes one (`DELETE /auth/logins/:provider`). Throws the API's error, e.g. for the last way in. */
  remove: (provider: string, proof: SignInProof) => Promise<void>;
}

/**
 * How the signed-in person can sign in (`GET /auth/logins`): whether there's a password, and which providers are linked.
 * Adding or removing one signs the account out everywhere else, and the API sends this device a fresh sign-in, which is
 * handed to `onSession` to keep.
 */
export function useLinkedSignIns(onSession?: (auth: AuthResponse) => void): LinkedSignInsState {
  const [info, setInfo] = useState<LinkedSignIns | null>(null);
  const session = useRef(onSession);
  useEffect(() => { session.current = onSession; }, [onSession]);

  /** Keeps the list, and hands on a fresh sign-in if the reply carries one. */
  const changed = useCallback((data: unknown) => {
    if (!isLinkedSignIns(data)) return;
    const { auth, ...rest } = data;
    if (isAuth(auth)) session.current?.(auth);
    setInfo(rest);
  }, []);

  useEffect(() => {
    let live = true;
    api.get<unknown>('/auth/logins')
      .then(({ data }) => { if (live) changed(data); })
      .catch(() => {});
    return () => { live = false; };
  }, [changed]);

  const connect = useCallback(async ({ provider, idToken, nonce }: SocialCredential, confirm: SignInProof) => {
    const { data } = await api.post<unknown>('/auth/logins', { provider, idToken, nonce, confirm });
    changed(data);
  }, [changed]);

  const remove = useCallback(async (provider: string, proof: SignInProof) => {
    const { data } = await api.delete<unknown>(`/auth/logins/${encodeURIComponent(provider)}`, { data: proof });
    changed(data);
  }, [changed]);

  return { info, connect, remove };
}
