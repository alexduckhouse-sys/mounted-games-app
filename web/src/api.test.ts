import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, readStoredAuth, readToken, rejectHtmlPage, writeStoredAuth, type StoredAuth } from './api';

const KEY = 'mg.auth';
const auth = (extra: Partial<StoredAuth> = {}): StoredAuth => ({
  token: 'secret-token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: 'u1', email: 'a@example.com', fullName: 'Ann', clubId: null, clubName: null, roles: ['Trainer'] },
  ...extra,
});

describe('stored auth', () => {
  it('is empty when nothing is stored', () => {
    expect(readStoredAuth()).toBeNull();
    expect(readToken()).toBeNull();
  });

  it('round-trips through localStorage', () => {
    const stored = auth();
    writeStoredAuth(stored);
    expect(readStoredAuth()).toEqual(stored);
    expect(readToken()).toBe('secret-token');
  });

  it('forgets the login when asked to write null', () => {
    writeStoredAuth(auth());
    writeStoredAuth(null);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readStoredAuth()).toBeNull();
  });

  it('discards an expired login and removes it from storage', () => {
    writeStoredAuth(auth({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(readStoredAuth()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('treats corrupt data as signed out', () => {
    localStorage.setItem(KEY, '{nope');
    expect(readStoredAuth()).toBeNull();
  });

  it('treats unreadable storage as signed out', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readStoredAuth()).toBeNull();
  });
});

describe('api client', () => {
  let seen: InternalAxiosRequestConfig[];
  let reply: (config: InternalAxiosRequestConfig) => Promise<unknown>;

  beforeEach(() => {
    seen = [];
    reply = async () => ({ ok: true });
    const adapter: AxiosAdapter = async (config) => {
      seen.push(config);
      const data = await reply(config);
      return { data, status: 200, statusText: 'OK', headers: {}, config };
    };
    api.defaults.adapter = adapter;
  });

  it('calls the API under /api by default', async () => {
    await api.get('/competitions');
    expect(seen[0].baseURL).toBe('/api');
  });

  it('sends the bearer token when signed in and no header when signed out', async () => {
    await api.get('/competitions');
    expect(seen[0].headers.get('Authorization')).toBeFalsy();
    writeStoredAuth(auth());
    await api.get('/competitions');
    expect(seen[1].headers.get('Authorization')).toBe('Bearer secret-token');
  });

  it('does not send an expired token', async () => {
    writeStoredAuth(auth({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await api.get('/competitions');
    expect(seen[0].headers.get('Authorization')).toBeFalsy();
  });

  it('gives GET requests a 15 second timeout unless they set their own', async () => {
    await api.get('/a');
    await api.get('/b', { timeout: 3000 });
    await api.post('/c', {});
    expect(seen.map((config) => config.timeout)).toEqual([15_000, 3000, 0]);
  });

  it('signs the user out when the server answers 401, and still rejects', async () => {
    writeStoredAuth(auth());
    reply = async (config) => { throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, { status: 401, statusText: 'Unauthorized', headers: {}, config, data: null }); };
    await expect(api.get('/auth/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the login for other failures, including a lost connection', async () => {
    writeStoredAuth(auth());
    reply = async (config) => { throw new AxiosError('Server error', 'ERR_BAD_RESPONSE', config, null, { status: 500, statusText: 'Error', headers: {}, config, data: null }); };
    await expect(api.get('/x')).rejects.toMatchObject({ response: { status: 500 } });
    reply = async (config) => { throw new AxiosError('Network Error', 'ERR_NETWORK', config); };
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'ERR_NETWORK' });
    expect(readStoredAuth()).not.toBeNull();
  });

  it.each(['text/html', 'text/html; charset=utf-8', 'TEXT/HTML'])('rejects an HTML page (%s) as a missing route', async (type) => {
    api.defaults.adapter = async (config) => ({ data: '<!doctype html><html></html>', status: 200, statusText: 'OK', headers: { 'content-type': type }, config });
    await expect(api.get('/admin/trainer-requests')).rejects.toMatchObject({ code: 'ERR_BAD_RESPONSE', response: { status: 404 } });
  });

  it('keeps JSON responses, and works with AxiosHeaders', async () => {
    api.defaults.adapter = async (config) => ({ data: [1], status: 200, statusText: 'OK', headers: new AxiosHeaders({ 'Content-Type': 'application/json' }), config });
    expect((await api.get('/x')).data).toEqual([1]);
    api.defaults.adapter = async (config) => ({ data: 'x', status: 200, statusText: 'OK', headers: new AxiosHeaders({ 'Content-Type': 'text/html' }), config });
    await expect(api.get('/x')).rejects.toMatchObject({ response: { status: 404 } });
  });

  it('passes responses through when they carry no content type at all', () => {
    const bare = { data: null, status: 204, statusText: 'No Content', config: {} } as never;
    expect(rejectHtmlPage(bare)).toBe(bare);
    const untyped = { data: {}, status: 200, statusText: 'OK', headers: {}, config: {} } as never;
    expect(rejectHtmlPage(untyped)).toBe(untyped);
  });

  it('passes successful responses through unchanged', async () => {
    reply = async () => ({ hello: 'world' });
    expect((await api.get('/x')).data).toEqual({ hello: 'world' });
  });
});

describe('request interceptor on bare configs', () => {
  type Handler = { fulfilled: (config: Record<string, unknown>) => Record<string, unknown> };
  const handler = () => (api.interceptors.request as unknown as { handlers: Handler[] }).handlers[0];

  it('copes with a request that has no method or headers yet', () => {
    writeStoredAuth(auth());
    const config = handler().fulfilled({});
    expect(config.headers).toEqual({ Authorization: 'Bearer secret-token' });
    expect(config.timeout).toBeUndefined();
  });

  it('leaves a signed-out request without headers untouched', () => {
    expect(handler().fulfilled({ method: 'GET' })).toEqual({ method: 'GET', timeout: 15_000 });
  });
});

describe('API base URL', () => {
  it('can be overridden at build time', async () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.example.com/api');
    vi.resetModules();
    const { api: custom } = await import('./api');
    expect(custom.defaults.baseURL).toBe('https://api.example.com/api');
  });
});
