import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER, CLIENT_LAT_HEADER, CLIENT_LON_HEADER, PROXY_KEY_HEADER, proxyRequestHeaders, roughPlaceFrom } from './proxyHeaders';

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

describe('the rough place of the connection', () => {
  const vercel = (lat: string | null, lon: string | null) => {
    const headers = new Headers();
    if (lat !== null) headers.set('x-vercel-ip-latitude', lat);
    if (lon !== null) headers.set('x-vercel-ip-longitude', lon);
    return headers;
  };

  it('is read from Vercel and rounded to one decimal place', () => {
    expect(roughPlaceFrom(vercel('51.454513', '-2.587910'))).toEqual({ latitude: '51.5', longitude: '-2.6' });
    expect(roughPlaceFrom(vercel('0', '0'))).toEqual({ latitude: '0.0', longitude: '0.0' });
  });

  it.each([
    ['nothing', null, null],
    ['only a latitude', '51.4', null],
    ['words', 'north', 'west'],
    ['a latitude off the globe', '91', '0'],
    ['a longitude off the globe', '0', '-181'],
    ['infinity', 'Infinity', '0'],
  ])('is nothing for %s', (_case, lat, lon) => {
    expect(roughPlaceFrom(vercel(lat, lon))).toBeUndefined();
  });

  it('is forwarded with the key and the IP, replacing anything the browser sent', () => {
    const forged = browser();
    forged.set(CLIENT_LAT_HEADER, '1.0');
    forged.set(CLIENT_LON_HEADER, '1.0');
    const headers = proxyRequestHeaders(forged, '198.51.100.7', 'secret', { latitude: '51.5', longitude: '-2.6' });
    expect(headers.get(CLIENT_LAT_HEADER)).toBe('51.5');
    expect(headers.get(CLIENT_LON_HEADER)).toBe('-2.6');
  });

  it('is never forwarded without the key and the IP, and forged values are dropped', () => {
    const forged = browser();
    forged.set(CLIENT_LAT_HEADER, '1.0');
    forged.set(CLIENT_LON_HEADER, '1.0');
    for (const [ip, key] of [['198.51.100.7', undefined], [undefined, 'secret'], ['198.51.100.7', '']] as const) {
      const headers = proxyRequestHeaders(forged, ip, key, { latitude: '51.5', longitude: '-2.6' });
      expect(headers.has(CLIENT_LAT_HEADER)).toBe(false);
      expect(headers.has(CLIENT_LON_HEADER)).toBe(false);
    }
  });

  it('is simply left off when there is none', () => {
    const headers = proxyRequestHeaders(browser(), '198.51.100.7', 'secret');
    expect(headers.has(CLIENT_LAT_HEADER)).toBe(false);
  });
});
