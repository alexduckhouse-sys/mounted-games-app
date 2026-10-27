import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import type { ExternalProvider } from '../types';

export const OAUTH_STATE_KEY = 'mg.oauth.pending';

interface PendingOAuthState {
  provider: string;
  state: string;
  nonce: string;
}

let cachedProviders: ExternalProvider[] | null = null;
let pendingFetch: Promise<ExternalProvider[]> | null = null;
const defaultRedirect = (url: string) => { window.location.assign(url); };
let redirectHandler: (url: string) => void = defaultRedirect;

/** Clears the cached provider list (and any custom redirect handler) between tests. */
// eslint-disable-next-line react-refresh/only-export-components
export function clearSocialProvidersCache() {
  cachedProviders = null;
  pendingFetch = null;
  redirectHandler = defaultRedirect;
}

/** Overrides `window.location.assign` in tests so jsdom does not complain about external navigation. */
// eslint-disable-next-line react-refresh/only-export-components
export function setSocialRedirectHandler(handler: (url: string) => void) {
  redirectHandler = handler;
}

function isExternalProvider(item: unknown): item is ExternalProvider {
  const p = item as Record<string, unknown> | null;
  return Boolean(
    p
    && typeof p === 'object'
    && typeof p.id === 'string'
    && typeof p.name === 'string'
    && typeof p.clientId === 'string'
    && typeof p.authorizeEndpoint === 'string'
    && typeof p.scope === 'string',
  );
}

async function fetchSocialProviders(): Promise<ExternalProvider[]> {
  if (cachedProviders) return cachedProviders;
  if (!pendingFetch) {
    pendingFetch = api.get<unknown>('/auth/providers')
      .then(({ data }) => {
        const list = Array.isArray(data) ? data.filter(isExternalProvider) : [];
        if (list.length > 0) cachedProviders = list;
        return list;
      })
      .catch(() => [])
      .finally(() => { pendingFetch = null; });
  }
  return pendingFetch;
}

function randomHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildAuthorizeUrl(provider: ExternalProvider, redirectUri: string, state: string, nonce: string): string {
  const url = new URL(provider.authorizeEndpoint);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('response_mode', provider.responseMode || 'fragment');
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  return url.toString();
}

function ProviderIcon({ id }: { id: string }) {
  switch (id.toLowerCase()) {
    case 'google':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0">
          <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z" />
          <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09Z" />
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96Z" />
        </svg>
      );
    case 'apple':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-current">
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z" />
        </svg>
      );
    case 'microsoft':
      return (
        <svg aria-hidden="true" viewBox="0 0 23 23" className="h-[18px] w-[18px] shrink-0">
          <path fill="#f35325" d="M1 1h10v10H1z" />
          <path fill="#81bc06" d="M12 1h10v10H12z" />
          <path fill="#05a6f0" d="M1 12h10v10H1z" />
          <path fill="#ffba08" d="M12 12h10v10H12z" />
        </svg>
      );
    default:
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-none stroke-current stroke-2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
  }
}

export interface SocialLoginButtonsProps {
  disabled?: boolean;
  onToken: (provider: string, idToken: string, nonce?: string) => void | Promise<void>;
  onError: (message: string) => void;
}

/**
 * Renders "Continue with Google / Apple / Microsoft" buttons when configured on the API,
 * and completes any `#id_token=...` OIDC redirect callback on mount.
 */
export function SocialLoginButtons({ disabled = false, onToken, onError }: SocialLoginButtonsProps) {
  const loc = useLocation();
  const [providers, setProviders] = useState<ExternalProvider[]>(() => cachedProviders ?? []);

  useEffect(() => {
    let cancelled = false;
    fetchSocialProviders().then((list) => {
      if (!cancelled && list.length > 0) setProviders(list);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loc.hash.length <= 1) return;
    const params = new URLSearchParams(loc.hash.slice(1));
    const idToken = params.get('id_token');
    const errorParam = params.get('error');
    if (!idToken && !errorParam) return;

    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch { /* ignore history errors */ }

    let stored: PendingOAuthState | null = null;
    try {
      const raw = sessionStorage.getItem(OAUTH_STATE_KEY);
      sessionStorage.removeItem(OAUTH_STATE_KEY);
      if (raw) stored = JSON.parse(raw) as PendingOAuthState;
    } catch { /* storage blocked or invalid JSON */ }

    if (errorParam) {
      onError('Sign-in was cancelled or refused by the provider.');
      return;
    }

    const returnedState = params.get('state');
    if (!stored || !stored.provider || stored.state !== returnedState) {
      onError('Could not verify that sign-in. Try again.');
      return;
    }

    void onToken(stored.provider, idToken!, stored.nonce);
  }, [loc.hash, onError, onToken]);

  if (providers.length === 0) return null;

  function startProviderLogin(provider: ExternalProvider) {
    const state = randomHex();
    const nonce = randomHex();
    try {
      sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ provider: provider.id, state, nonce }));
    } catch { /* storage blocked */ }
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    redirectHandler(buildAuthorizeUrl(provider, redirectUri, state, nonce));
  }

  return (
    <div className="flex flex-col gap-2.5">
      {providers.map((p) => (
        <button
          key={p.id}
          type="button"
          disabled={disabled}
          onClick={() => startProviderLogin(p)}
          className="mg-btn mg-btn-secondary flex w-full items-center justify-center gap-2.5"
        >
          <ProviderIcon id={p.id} />
          <span>Continue with {p.name}</span>
        </button>
      ))}
      <div className="my-1 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
        <span className="h-px flex-1 bg-[rgb(var(--mg-control))]" />
        <span>or</span>
        <span className="h-px flex-1 bg-[rgb(var(--mg-control))]" />
      </div>
    </div>
  );
}
