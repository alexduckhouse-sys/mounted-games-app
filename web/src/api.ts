import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios';

const TOKEN_KEY = 'mg.auth';
export const AUTH_CHANGED_EVENT = 'mg:auth-changed';
const notifyAuthChanged = () => queueMicrotask(() => window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)));

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
      clearPrivateDrafts();
      notifyAuthChanged();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPrivateDrafts() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('mg.draft.entry.') || key.startsWith('mg.draft.decform.')
        || key.startsWith('competitionEditor:') || key === 'mg.draft.admin-email'
        || key.startsWith('mg.announceDraft.')) localStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable. */ }
}

export function writeStoredAuth(auth: StoredAuth | null) {
  if (!auth || readStoredAuth()?.user.id !== auth.user.id) clearPrivateDrafts();
  if (auth) localStorage.setItem(TOKEN_KEY, JSON.stringify(auth));
  else localStorage.removeItem(TOKEN_KEY);
  notifyAuthChanged();
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

export interface IpBlock {
  id: number;
  ipAddress: string;
  reason: string | null;
  createdAt: string;
}

export const getIpBlocks = () => api.get<IpBlock[]>('/ip-blocks');
export const createIpBlock = (input: { ip: string; reason: string }) => api.post<IpBlock>('/ip-blocks', { ipAddress: input.ip, reason: input.reason });
export const deleteIpBlock = (id: number) => api.delete(`/ip-blocks/${id}`);
export const pinChatMessage = (competitionId: number, messageId: number) => api.post<import('./types').ChatMessage>(`/competitions/${competitionId}/chat/${messageId}/pin`, {});
