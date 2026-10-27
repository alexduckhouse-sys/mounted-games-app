import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  FACEBOOK_GRAPH_VERSION, loadApple, loadFacebook, loadGoogle, makeNonce, randomState,
  type AppleAuthApi, type FacebookApi, type SignInNonce,
} from '../auth/socialSdk';
import { useLanguage, useT } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/translate';
import type { ExternalProvider } from '../types';

/** What a provider hands back, ready for `POST /auth/external`. */
export interface SocialCredential {
  provider: ExternalProvider['id'];
  idToken: string;
  /** The raw nonce whose hash the provider put in the token. Facebook's flow has none. */
  nonce?: string;
  /** Apple's name for the person, sent on the first sign-in only. Only ever a suggestion for a new account. */
  providerName?: string;
}

export interface SocialLoginButtonsProps {
  disabled?: boolean;
  onCredential: (credential: SocialCredential) => void | Promise<void>;
  onError: (message: string) => void;
  /** Only these providers, e.g. the ones an account can still add, or the ones it can confirm with. */
  only?: ExternalProvider['id'][];
  /** The "or" line above an email form. On by default. */
  divider?: boolean;
  /** "Sign in with …" (default), or "Continue with …" when adding a provider to an account. Both are the providers' own wording. */
  label?: 'signin' | 'continue';
}

/**
 * Google draws its own button and words it in the language we pass. Welsh and French use the plain language code;
 * English stays British.
 */
const GOOGLE_LOCALE: Record<Lang, string> = { en: 'en-GB', cy: 'cy', fr: 'fr' };

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
  return Boolean(p && typeof p === 'object' && (p.id === 'google' || p.id === 'apple' || p.id === 'facebook')
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

/** The sign-in providers the API has switched on, fetched once per page load and remembered. Empty until then, or offline. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSocialProviders(): ExternalProvider[] {
  const [providers, setProviders] = useState<ExternalProvider[]>(() => cachedProviders ?? []);
  useEffect(() => {
    let cancelled = false;
    fetchProviders().then((list) => { if (!cancelled && list.length > 0) setProviders(list); });
    return () => { cancelled = true; };
  }, []);
  return providers;
}

/** Keeps the latest callbacks without re-running the provider set-up when a parent re-renders. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}

interface ButtonProps extends Omit<SocialLoginButtonsProps, 'only' | 'divider'> { clientId: string }

/**
 * Google's own "Sign in with Google" button (Google Identity Services), so its branding and wording are Google's, in
 * the app's language (`locale`). It opens Google's
 * pop-up and hands the ID token to a callback here; nothing is put in the address bar.
 */
function GoogleButton({ clientId, disabled, label, onCredential, onError }: ButtonProps) {
  const slot = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const { t, lang } = useLanguage();
  const latest = useLatest({ onCredential, onError, t });
  const locale = GOOGLE_LOCALE[lang];

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
          else latest.current.onError(latest.current.t('auth.social.googleFailed'));
        },
      });
      const width = Math.round(slot.current.getBoundingClientRect().width) || 320;
      google.renderButton(slot.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: label === 'continue' ? 'continue_with' : 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'center',
        width: Math.min(400, Math.max(200, width)),
        locale,
      });
      setStatus('ready');
    }).catch(() => { if (live) setStatus('failed'); });
    return () => { live = false; };
  }, [clientId, label, locale, latest]);

  if (status === 'failed') {
    return <p role="status" className="m-0 text-center text-sm text-[rgb(var(--mg-muted))]">{t('auth.social.googleUnavailable')}</p>;
  }
  return (
    <div className="relative flex min-h-[44px] justify-center" aria-busy={status === 'loading'}>
      <div ref={slot} data-testid="google-signin" className="w-full max-w-[400px]" />
      {/* Google's button is a frame we can't disable, so a cover takes the taps while a sign-in is under way. */}
      {disabled && <div data-testid="google-signin-cover" aria-hidden="true" className="absolute inset-0 cursor-not-allowed bg-[rgb(var(--mg-surface)/0.5)]" />}
    </div>
  );
}

function FacebookLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.026 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.931-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073Z" />
    </svg>
  );
}

/**
 * "Continue with Facebook" (Facebook's own wording) in Facebook blue, opening Facebook's pop-up. Facebook's SDK is set
 * up with no FedCM, no login-status check, no cookie and nothing stored, so the pop-up is all it does and the CSP needs
 * only its two scripts. `FB.login` runs straight from the tap so the browser lets the pop-up open. Facebook gives an
 * access token (no ID token and no nonce); the API checks it with Facebook.
 */
function FacebookButton({ clientId, disabled, onCredential }: ButtonProps) {
  const t = useT();
  const sdk = useRef<FacebookApi | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let live = true;
    loadFacebook().then((facebook) => {
      if (!live) return;
      facebook.init({ appId: clientId, version: FACEBOOK_GRAPH_VERSION, cookie: false, xfbml: false, status: false, localStorage: false, fedCM: false });
      sdk.current = facebook;
      setStatus('ready');
    }).catch(() => { if (live) setStatus('failed'); });
    return () => { live = false; };
  }, [clientId]);

  function signIn() {
    // The button stays disabled until the SDK is ready.
    sdk.current!.login((response) => {
      const token = response.authResponse?.accessToken;
      // No token means the person closed Facebook's window or said no: a change of mind, not a fault.
      if (token) void onCredential({ provider: 'facebook', idToken: token });
    }, { scope: 'public_profile,email' });
  }

  if (status === 'failed') {
    return <p role="status" className="m-0 text-center text-sm text-[rgb(var(--mg-muted))]">{t('auth.social.facebookUnavailable')}</p>;
  }
  return (
    <button
      type="button"
      onClick={signIn}
      disabled={disabled || status !== 'ready'}
      className="mg-btn w-full !min-h-[44px] border-[#1877F2] bg-[#1877F2] text-white"
    >
      <FacebookLogo />
      <span>{t('auth.social.facebookContinue')}</span>
    </button>
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
 * "Sign in with Apple" in Apple's black style (white on the dark theme), opening Apple's pop-up. The words are Apple's
 * own titles: French uses Apple's French ones, and Welsh keeps the English because Apple has none. `signIn` runs straight
 * from the tap so Safari lets the pop-up open, which is why Apple's script is loaded and set up before the button is enabled.
 */
function AppleButton({ clientId, disabled, label, onCredential, onError }: ButtonProps) {
  const t = useT();
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
          onError(t('auth.social.notChecked'));
          return;
        }
        const name = [data.user?.name?.firstName, data.user?.name?.lastName].map((part) => part?.trim()).filter(Boolean).join(' ');
        return onCredential({ provider: 'apple', idToken, nonce: current.nonce.raw, ...(name ? { providerName: name } : {}) });
      },
      (err: unknown) => {
        const code = (err as { error?: string } | null)?.error;
        // Closing Apple's window is a change of mind, not a fault.
        if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return;
        onError(t('auth.social.appleFailed'));
      },
    );
  }

  if (status === 'failed') {
    return <p role="status" className="m-0 text-center text-sm text-[rgb(var(--mg-muted))]">{t('auth.social.appleUnavailable')}</p>;
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
      <span>{t(label === 'continue' ? 'auth.social.appleContinue' : 'auth.social.appleSignIn')}</span>
    </button>
  );
}

/**
 * "Sign in with Google", "Sign in with Apple" and "Continue with Facebook", for whichever the API has switched on (`GET /auth/providers`), then an
 * "or" above the email and password form. Shows nothing when none is on (or none of `only`) or the list can't be fetched.
 */
export function SocialLoginButtons({ only, divider = true, ...props }: SocialLoginButtonsProps) {
  const t = useT();
  const providers = useSocialProviders();
  const shown = only ? providers.filter((p) => only.includes(p.id)) : providers;
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((p) => {
        if (p.id === 'google') return <GoogleButton key={p.id} clientId={p.clientId} {...props} />;
        if (p.id === 'apple') return <AppleButton key={p.id} clientId={p.clientId} {...props} />;
        return <FacebookButton key={p.id} clientId={p.clientId} {...props} />;
      })}
      {divider && (
        <div className="my-1 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--mg-muted))]">
          <span className="h-px flex-1 bg-[rgb(var(--mg-control))]" />
          <span>{t('auth.social.or')}</span>
          <span className="h-px flex-1 bg-[rgb(var(--mg-control))]" />
        </div>
      )}
    </div>
  );
}
