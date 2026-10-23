// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const next = vi.hoisted(() => vi.fn());
const ipAddress = vi.hoisted(() => vi.fn());
vi.mock('@vercel/functions', () => ({ next, ipAddress }));

import middleware, { config } from '../../middleware';

const WHATSAPP = 'WhatsApp/2.23.20.0 A';
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const PASS = { passed: true };

function ask(path: string, userAgent: string | null, method = 'GET') {
  const headers = new Headers();
  if (userAgent) headers.set('user-agent', userAgent);
  return middleware(new Request(`https://mg.example${path}`, { method, headers }));
}

beforeEach(() => {
  next.mockReturnValue(PASS);
  ipAddress.mockReturnValue('198.51.100.7');
  vi.stubEnv('MG_PROXY_KEY', 'k'.repeat(32));
  vi.stubGlobal('fetch', vi.fn());
});

it('covers the API, home, competition and team profile paths', () => {
  expect(config.matcher).toEqual(['/api/:path*', '/', '/competitions/:path*', '/team-profiles/:path*']);
});

it('still forwards the visitor IP on API requests', async () => {
  expect(await ask('/api/competitions', BROWSER)).toBe(PASS);
  const options = next.mock.calls[0][0] as { request: { headers: Headers } };
  expect(options.request.headers.get('x-mg-client-ip')).toBe('198.51.100.7');
  expect(fetch).not.toHaveBeenCalled();
});

it('leaves people, and pages without a card, to the app', async () => {
  expect(await ask('/competitions/12', BROWSER)).toBe(PASS);
  expect(await ask('/competitions/12', null)).toBe(PASS);
  expect(await ask('/competitions/past/more', WHATSAPP)).toBe(PASS);
  expect(await ask('/competitions/12', WHATSAPP, 'POST')).toBe(PASS);
  expect(fetch).not.toHaveBeenCalled();
});

it('answers a crawler with the tags for a competition, built from the public card', async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({
    name: '"><script>alert(1)</script>', startDate: '2026-10-17T08:00:00Z', endDate: null, location: 'Tatton Park', teamCount: 4,
  }));

  const response = await ask('/competitions/12/scoring', WHATSAPP) as Response;
  const html = await response.text();

  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('private, max-age=300');
  expect(response.headers.get('vary')).toBe('User-Agent');
  expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  expect(html).toContain('<meta property="og:title" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">');
  expect(html).not.toContain('<script');
  expect(html).toContain('https://mg.example/competitions/12');

  const [target, init] = vi.mocked(fetch).mock.calls[0];
  expect(target).toBe('https://mounted-games-api.vercel.app/api/share/competitions/12');
  const sent = (init as RequestInit).headers as Headers;
  expect(sent.get('x-mg-client-ip')).toBe('198.51.100.7');
  expect(sent.get('cookie')).toBeNull();
});

it('answers a crawler asking for a team profile, and a HEAD request without a body', async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ displayName: 'Cheshire A', clubName: 'Cheshire PC', eventCount: 2 }));
  const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const head = await ask(`/team-profiles/${id}`, WHATSAPP, 'HEAD') as Response;
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(vi.mocked(fetch).mock.calls[0][0]).toContain(`/api/share/team-profiles/${id}`);
});

it('gives the generic card without calling the API', async () => {
  const html = await (await ask('/', WHATSAPP) as Response).text();
  expect(html).toContain('og:title');
  expect(fetch).not.toHaveBeenCalled();
});

it('uses MG_API_ORIGIN when set', async () => {
  vi.stubEnv('MG_API_ORIGIN', 'https://preview-api.example/');
  vi.mocked(fetch).mockResolvedValue(Response.json({ name: 'A', startDate: '2026-10-17T08:00:00Z' }));
  await ask('/competitions/3', WHATSAPP);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://preview-api.example/api/share/competitions/3');
});

it('falls back to the app when the competition is unknown, the API fails or the body is odd', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 404 }));
  expect(await ask('/competitions/99', WHATSAPP)).toBe(PASS);
  vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'));
  expect(await ask('/competitions/99', WHATSAPP)).toBe(PASS);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ unexpected: true }));
  expect(await ask('/competitions/99', WHATSAPP)).toBe(PASS);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ nope: 1 }));
  expect(await ask('/team-profiles/3f2504e0-4f89-11d3-9a0c-0305e82c3301', WHATSAPP)).toBe(PASS);
});
