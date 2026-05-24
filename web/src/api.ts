import axios, { type AxiosInstance } from 'axios';

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
  const token = readToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      writeStoredAuth(null);
    }
    return Promise.reject(err);
  }
);
