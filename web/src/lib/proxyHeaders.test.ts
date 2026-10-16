import { expect, it } from 'vitest';
import { CLIENT_IP_HEADER, PROXY_KEY_HEADER, proxyRequestHeaders } from './proxyHeaders';

const browser = () => new Headers({ accept: 'application/json', authorization: 'Bearer token' });

it('adds the visitor IP and the proxy key, keeping the original headers', () => {
  const headers = proxyRequestHeaders(browser(), '198.51.100.7', 'secret');
  expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.7');
  expect(headers.get(PROXY_KEY_HEADER)).toBe('secret');
  expect(headers.get('authorization')).toBe('Bearer token');
  expect(headers.get('accept')).toBe('application/json');
});

it('drops forged values sent by the browser', () => {
  const forged = browser();
  forged.set(CLIENT_IP_HEADER, '203.0.113.1');
  forged.set(PROXY_KEY_HEADER, 'guess');
  const headers = proxyRequestHeaders(forged, '198.51.100.7', 'secret');
  expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.7');
  expect(headers.get(PROXY_KEY_HEADER)).toBe('secret');
});

it.each([
  ['no key configured', '198.51.100.7', undefined],
  ['an empty key', '198.51.100.7', ''],
  ['no visitor IP', undefined, 'secret'],
])('adds nothing with %s, and still drops forged values', (_case, ip, key) => {
  const forged = browser();
  forged.set(CLIENT_IP_HEADER, '203.0.113.1');
  forged.set(PROXY_KEY_HEADER, 'guess');
  const headers = proxyRequestHeaders(forged, ip, key);
  expect(headers.has(CLIENT_IP_HEADER)).toBe(false);
  expect(headers.has(PROXY_KEY_HEADER)).toBe(false);
  expect(headers.get('authorization')).toBe('Bearer token');
});

it('does not change the headers it was given', () => {
  const original = browser();
  proxyRequestHeaders(original, '198.51.100.7', 'secret');
  expect(original.has(CLIENT_IP_HEADER)).toBe(false);
});
