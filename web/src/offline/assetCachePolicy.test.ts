import { describe, expect, it } from 'vitest';
import { isLazyBuildAsset, canCacheBuildAsset } from './assetCachePolicy';

describe('lazy build asset caching', () => {
  it('accepts only same-origin hashed JavaScript and CSS GETs', () => {
    const origin = 'https://example.test';
    expect(isLazyBuildAsset(new URL('/assets/fr-Abc_1234.js', origin), origin, 'GET')).toBe(true);
    expect(isLazyBuildAsset(new URL('/assets/EntriesPage-Abc-1234.css', origin), origin, 'GET')).toBe(true);
    for (const path of ['/api/secret-Abc12345.js', '/hubs/live', '/assets/app.js', '/index.html', '/assets/a/part-Abc12345.js']) {
      expect(isLazyBuildAsset(new URL(path, origin), origin, 'GET')).toBe(false);
    }
    expect(isLazyBuildAsset(new URL('/assets/a-Abc12345.js', 'https://elsewhere.test'), origin, 'GET')).toBe(false);
    expect(isLazyBuildAsset(new URL('/assets/a-Abc12345.js', origin), origin, 'POST')).toBe(false);
  });
  it('never caches HTML fallbacks, errors, redirects or opaque responses', () => {
    for (const type of ['text/css', 'text/javascript; charset=utf-8', 'application/javascript']) {
      expect(canCacheBuildAsset(new Response('asset', { headers: { 'content-type': type } }))).toBe(true);
    }
    for (const type of ['text/html', 'application/json', 'application/octet-stream']) {
      expect(canCacheBuildAsset(new Response('body', { headers: { 'content-type': type } }))).toBe(false);
    }
    expect(canCacheBuildAsset(new Response(null))).toBe(false);
    expect(canCacheBuildAsset(new Response('missing', { status: 404, headers: { 'content-type': 'text/javascript' } }))).toBe(false);
    const redirected = new Response('asset', { headers: { 'content-type': 'text/javascript' } });
    Object.defineProperty(redirected, 'redirected', { value: true });
    expect(canCacheBuildAsset(redirected)).toBe(false);
  });
});
