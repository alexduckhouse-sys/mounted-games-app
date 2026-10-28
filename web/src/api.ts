import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios';

const TOKEN_KEY = 'mg.auth';

export interface StoredAuth {
  token: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    clubId: number | null;
    clubName: string | null;
    roles: string[];
    /** False until the email address is confirmed; missing on saved logins from before this existed. */
    emailConfirmed?: boolean;
  };
}

export function readStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredAuth(auth: StoredAuth | null) {
  if (auth) localStorage.setItem(TOKEN_KEY, JSON.stringify(auth));
  else localStorage.removeItem(TOKEN_KEY);
}

export function readToken(): string | null {
  return readStoredAuth()?.token ?? null;
}

const baseURL = import.meta.env.VITE_API_BASE ?? '/api';

export const api: AxiosInstance = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  if (config.method?.toLowerCase() === 'get' && !config.timeout) config.timeout = 15_000;
  const token = readToken();
  const headers = config.headers as Record<string, unknown> | undefined;
  if (token && headers?.['Authorization'] === undefined) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

/**
 * An API build that doesn't know a route answers with the app's HTML page and a 200. That page is
 * never data, so reject it as a missing route; callers' error handling then covers it, instead of
 * a component trying to read a string as a list.
 */
export function rejectHtmlPage(response: AxiosResponse): AxiosResponse | Promise<never> {
  const headers = response.headers as { get?: (name: string) => unknown; [name: string]: unknown } | undefined;
  const type = String((typeof headers?.get === 'function' ? headers.get('content-type') : headers?.['content-type']) ?? '');
  if (!type.toLowerCase().includes('text/html')) return response;
  return Promise.reject(new AxiosError('The API returned a web page instead of data.', AxiosError.ERR_BAD_RESPONSE,
    response.config, response.request, { ...response, status: 404, statusText: 'Not Found' }));
}

/** The bearer token a request went out with, or null when it carried none. */
function tokenSentWith(config: { headers?: unknown } | undefined): string | null {
  const headers = config?.headers as { get?: (name: string) => unknown; [name: string]: unknown } | undefined;
  const value = typeof headers?.get === 'function' ? headers.get('Authorization') : headers?.['Authorization'];
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice('Bearer '.length) : null;
}

api.interceptors.response.use(
  rejectHtmlPage,
  (err) => {
    // Sign out only if the refused token is still the stored one: a request sent before a password change, answered after
    // the fresh token was stored, must not throw the fresh one away.
    if (err?.response?.status === 401) {
      const sent = tokenSentWith(err.config);
      if (sent !== null && sent === readToken()) writeStoredAuth(null);
    }
    return Promise.reject(err);
  }
);
