import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { loadApple, loadGoogle, makeNonce, randomState, type AppleAuthApi, type SignInNonce } from '../auth/socialSdk';
import type { ExternalProvider } from '../types';

/** What a provider hands back, ready for `POST /auth/external`. */
export interface SocialCredential {
  provider: ExternalProvider['id'];
  idToken: string;
  /** The raw nonce whose hash the provider put in the token. */
  nonce: string;
  /** Apple's name for the person, sent on the first sign-in only. Only ever a suggestion for a new account. */
  providerName?: string;
}

export interface SocialLoginButtonsProps {
  disabled?: boolean;
  onCredential: (credential: SocialCredential) => void | Promise<void>;
  onError: (message: string) => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const SOCIAL_COPY = {
  googleUnavailable: 'Google sign-in didn’t load. Check your signal, or use your email and password.',
  appleUnavailable: 'Apple sign-in didn’t load. Check your signal, or use your email and password.',
  googleFailed: 'Google sign-in didn’t work. Try again, or use your email and password.',
  appleFailed: 'Apple sign-in didn’t work. Try again, or use your email and password.',
  notChecked: 'We couldn’t check that sign-in. Try again.',
};

let cachedProviders: ExternalProvider[] | null = null;
let pendingFetch: Promise<ExternalProvider[]> | null = null;

/** Forgets the provider list between tests. */
// eslint-disable-next-line react-refresh/only-export-components
export function clearSocialProvidersCache() {
  cachedProviders = null;
  pendingFetch = null;
}

function isProvider(item: unknown): item is ExternalProvider {
  const p = item as Record<string, unknown> | null;
  return Boolean(p && typeof p === 'object' && (p.id === 'google' || p.id === 'apple')
    && typeof p.name === 'string' && typeof p.clientId === 'string' && p.clientId.length > 0);
}

function fetchProviders(): Promise<ExternalProvider[]> {
  if (cachedProviders) return Promise.resolve(cachedProviders);
  pendingFetch ??= api.get<unknown>('/auth/providers')
    .then(({ data }) => {
      const list = Array.isArray(data) ? data.filter(isProvider) : [];
      if (list.length > 0) cachedProviders = list;
      return list;
    })
    .catch(() => [])
    .finally(() => { pendingFetch = null; });
  return pendingFetch;
}

/** Keeps the latest callbacks without re-running the provider set-up when a parent re-renders. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}

interface ButtonProps extends SocialLoginButtonsProps { clientId: string }

/**
 * Google's own "Sign in with Google" button (Google Identity Services), so its branding is Google's. It opens Google's
 * pop-up and hands the ID token to a callback here; nothing is put in the address bar.
 */
function GoogleButton({ clientId, disabled, onCredential, onError }: ButtonProps) {
  const slot = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const latest = useLatest({ onCredential, onError });

  useEffect(() => {
    let live = true;
    Promise.all([loadGoogle(), makeNonce()]).then(([google, nonce]) => {
      if (!live || !slot.current) return;
      google.initialize({
        client_id: clientId,
        nonce: nonce.hashed,
        ux_mode: 'popup',
        auto_select: false,
        itp_support: true,
        context: 'signin',
        callback: (response) => {
          if (!live) return;
          if (response.credential) void latest.current.onCredential({ provider: 'google', idToken: response.credential, nonce: nonce.raw });
          else latest.current.onError(SOCIAL_COPY.googleFailed);
        },
      });
      const width = Math.round(slot.current.getBoundingClientRect().width) || 320;
      google.renderButton(slot.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'center',
        width: Math.min(400, Math.max(200, width)),
        locale: 'en-GB',
      });
      setStatus('ready');
    }).catch(() => { if (live) setStatus('failed'); });
    return () => { live = false; };
  }, [clientId, latest]);

  if (status === 'failed') {
    return <p role="status" className="m-0 text-center text-sm text-[rgb(var(--mg-muted))]">{SOCIAL_COPY.googleUnavailable}</p>;
  }
  return (
    <div className="relative flex min-h-[44px] justify-center" aria-busy={status === 'loading'}>
      <div ref={slot} data-testid="google-signin" className="w-full max-w-[400px]" />
      {/* Google's button is a frame we can't disable, so a cover takes the taps while a sign-in is under way. */}
      {disabled && <div data-testid="google-signin-cover" aria-hidden="true" className="absolute inset-0 cursor-not-allowed bg-[rgb(var(--mg-surface)/0.5)]" />}
    </div>
  );
}

function AppleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-current">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z" />
    </svg>
  );
}

/**
 * "Sign in with Apple" in Apple's black style (white on the dark theme), opening Apple's pop-up. `signIn` runs straight
 * from the tap so Safari lets the pop-up open, which is why Apple's script is loaded and set up before the button is enabled.
 */
function AppleButton({ clientId, disabled, onCredential, onError }: ButtonProps) {
  const session = useRef<{ apple: AppleAuthApi; nonce: SignInNonce; state: string } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let live = true;
    Promise.all([loadApple(), makeNonce()]).then(([apple, nonce]) => {
      if (!live) return;
      const state = randomState();
      // The return address must be registered with Apple; the reply itself comes back to this page by postMessage.
      apple.init({ clientId, scope: 'name email', redirectURI: `${window.location.origin}/login`, state, nonce: nonce.hashed, usePopup: true });
      session.current = { apple, nonce, state };
      setStatus('ready');
    }).catch(() => { if (live) setStatus('failed'); });
    return () => { live = false; };
  }, [clientId]);

  function signIn() {
    // The button stays disabled until the session exists.
    const current = session.current!;
    current.apple.signIn().then(
      (data) => {
        const idToken = data.authorization?.id_token;
        if (!idToken || data.authorization?.state !== current.state) {
          onError(SOCIAL_COPY.notChecked);
          return;
        }
        const name = [data.user?.name?.firstName, data.user?.name?.lastName].map((part) => part?.trim()).filter(Boolean).join(' ');
        return onCredential({ provider: 'apple', idToken, nonce: current.nonce.raw, ...(name ? { providerName: name } : {}) });
      },
      (err: unknown) => {
        const code = (err as { error?: string } | null)?.error;
        // Closing Apple's window is a change of mind, not a fault.
        if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return;
        onError(SOCIAL_COPY.appleFailed);
      },
    );
  }

  if (status === 'failed') {
    return <p role="status" className="m-0 text-center text-sm text-[rgb(var(--mg-muted))]">{SOCIAL_COPY.appleUnavailable}</p>;
  }
  return (
    <button
      type="button"
      onClick={signIn}
      disabled={disabled || status !== 'ready'}
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif' }}
      className="mg-btn w-full !min-h-[44px] border-black bg-black text-white [[data-theme=dark]_&]:border-white [[data-theme=dark]_&]:bg-white [[data-theme=dark]_&]:text-black"
    >
      <AppleLogo />
      <span>Sign in with Apple</span>
    </button>
  );
}

/**
 * "Sign in with Google" and "Sign in with Apple", for whichever the API has switched on (`GET /auth/providers`), then an
 * "or" above the email and password form. Shows nothing when neither is on or the list can't be fetched.
 */
export function SocialLoginButtons(props: SocialLoginButtonsProps) {
  const [providers, setProviders] = useState<ExternalProvider[]>(() => cachedProviders ?? []);

  useEffect(() => {
    let cancelled = false;
    fetchProviders().then((list) => { if (!cancelled && list.length > 0) setProviders(list); });
    return () => { cancelled = true; };
  }, []);

  if (providers.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {providers.map((p) => (p.id === 'google'
        ? <GoogleButton key={p.id} clientId={p.clientId} {...props} />
        : <AppleButton key={p.id} clientId={p.clientId} {...props} />))}
      <div className="my-1 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
        <span className="h-px flex-1 bg-[rgb(var(--mg-control))]" />
        <span>or</span>
        <span className="h-px flex-1 bg-[rgb(var(--mg-control))]" />
      </div>
    </div>
  );
}
