/**
 * The two sign-in providers' own scripts (Google Identity Services, Sign in with Apple JS), loaded only when the sign-in
 * page shows their buttons, and the nonce we hand them.
 *
 * Both script addresses are allowed by exact path in the Content-Security-Policy, in `web/vercel.json` and
 * `api/Security/SecurityHeadersMiddleware.cs`. Change all three together.
 */
export const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
export const APPLE_SCRIPT = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_GB/appleid.auth.js';
/** Facebook's loader. It fetches the SDK itself from `https://connect.facebook.net/en_GB/bundle/sdk.js/`, also in the CSP. */
export const FACEBOOK_SCRIPT = 'https://connect.facebook.net/en_GB/sdk.js';
/** Keep in step with `FacebookApp.DefaultGraphVersion` in `api/Auth/FacebookSignIn.cs`. */
export const FACEBOOK_GRAPH_VERSION = 'v23.0';
/** How long to wait for Facebook's SDK to say it's ready before showing that it didn't load. */
export const FACEBOOK_READY_TIMEOUT_MS = 15_000;

export interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

export interface GoogleButtonOptions {
  type: 'standard' | 'icon';
  theme: 'outline' | 'filled_blue' | 'filled_black';
  size: 'large' | 'medium' | 'small';
  text: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment: 'left' | 'center';
  width: number;
  locale: string;
}

/** The part of `google.accounts.id` we use. */
export interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce: string;
    ux_mode: 'popup';
    auto_select: boolean;
    itp_support: boolean;
    context: 'signin';
  }): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
}

export interface AppleSignInResponse {
  authorization?: { id_token?: string; code?: string; state?: string };
  /** Only on the first sign-in to this app. */
  user?: { email?: string; name?: { firstName?: string; lastName?: string } };
}

/** The part of `AppleID.auth` we use. */
export interface AppleAuthApi {
  init(config: { clientId: string; scope: string; redirectURI: string; state: string; nonce: string; usePopup: boolean }): void;
  signIn(): Promise<AppleSignInResponse>;
}

export interface FacebookLoginResponse {
  status?: string;
  /** Missing when the person closed the window or said no. */
  authResponse?: { accessToken?: string; userID?: string } | null;
}

/** The part of Facebook's `FB` we use. */
export interface FacebookApi {
  init(options: {
    appId: string;
    version: string;
    cookie: boolean;
    xfbml: boolean;
    status: boolean;
    localStorage: boolean;
    fedCM: boolean;
  }): void;
  login(callback: (response: FacebookLoginResponse) => void, options: { scope: string }): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
    AppleID?: { auth?: AppleAuthApi };
    FB?: FacebookApi;
    /** Facebook's SDK calls this once it has fully loaded. */
    fbAsyncInit?: () => void;
  }
}

const loading = new Map<string, Promise<void>>();

/** Adds the script once. A failed load is forgotten, so the next visit to the page tries again. */
export function loadScript(src: string): Promise<void> {
  const known = loading.get(src);
  if (known) return known;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading.delete(src);
      script.remove();
      reject(new Error(`Couldn't load ${src}`));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

export async function loadGoogle(): Promise<GoogleIdApi> {
  await loadScript(GOOGLE_SCRIPT);
  const api = window.google?.accounts?.id;
  if (!api) throw new Error('Google Identity Services did not start');
  return api;
}

export async function loadApple(): Promise<AppleAuthApi> {
  await loadScript(APPLE_SCRIPT);
  const api = window.AppleID?.auth;
  if (!api) throw new Error('Sign in with Apple JS did not start');
  return api;
}

let facebookReady: Promise<FacebookApi> | null = null;

/**
 * Facebook's SDK. Its loader script defines `FB` at once but only queues calls until the real SDK arrives, and a queued
 * `FB.login` would open its pop-up outside the tap (so the browser blocks it). So this waits for `fbAsyncInit`, which
 * the SDK calls when it is ready, and gives up after {@link FACEBOOK_READY_TIMEOUT_MS}.
 */
export function loadFacebook(): Promise<FacebookApi> {
  facebookReady ??= new Promise<FacebookApi>((resolve, reject) => {
    const fail = (error: Error) => {
      facebookReady = null;
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('Facebook SDK did not start')), FACEBOOK_READY_TIMEOUT_MS);
    window.fbAsyncInit = () => {
      clearTimeout(timer);
      if (window.FB) resolve(window.FB);
      else fail(new Error('Facebook SDK did not start'));
    };
    loadScript(FACEBOOK_SCRIPT).catch((error: Error) => {
      clearTimeout(timer);
      fail(error);
    });
  });
  return facebookReady;
}

/** Forgets loaded scripts. For tests. */
export function resetSocialSdk() {
  loading.clear();
  facebookReady = null;
  delete window.fbAsyncInit;
}

export interface SignInNonce {
  /** Sent to our API with the ID token. Never given to the provider. */
  raw: string;
  /** Lower-case hex SHA-256 of `raw`: what the provider puts in the token. */
  hashed: string;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A fresh nonce. The provider only ever sees the hash, so a token copied from anywhere is useless without the raw value,
 * which stays in this page until it goes to our API (`api/Auth/ExternalAuth.cs`, `ExternalNonce`).
 */
export async function makeNonce(): Promise<SignInNonce> {
  const raw = hex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return { raw, hashed: hex(new Uint8Array(digest)) };
}

/** A random value Apple sends back unchanged, so a reply from another sign-in attempt is ignored. */
export function randomState(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}
