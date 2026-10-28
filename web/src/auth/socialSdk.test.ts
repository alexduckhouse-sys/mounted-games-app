import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPLE_SCRIPT,
  FACEBOOK_GRAPH_VERSION,
  FACEBOOK_READY_TIMEOUT_MS,
  FACEBOOK_SCRIPT,
  GOOGLE_SCRIPT,
  loadApple,
  loadFacebook,
  loadGoogle,
  loadScript,
  makeNonce,
  randomState,
  resetSocialSdk,
  type AppleAuthApi,
  type FacebookApi,
  type GoogleIdApi,
} from './socialSdk';

const scripts = (src: string) => Array.from(document.head.querySelectorAll<HTMLScriptElement>('script')).filter((s) => s.src === src);
const finish = (src: string, event: 'load' | 'error') => scripts(src).at(-1)!.dispatchEvent(new Event(event));

afterEach(() => {
  resetSocialSdk();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  delete window.google;
  delete window.AppleID;
  delete window.FB;
});

describe('loadScript', () => {
  it('adds a script once, however many times it is asked for', async () => {
    const first = loadScript('https://example.test/a.js');
    const second = loadScript('https://example.test/a.js');
    expect(second).toBe(first);
    expect(scripts('https://example.test/a.js')).toHaveLength(1);
    expect(scripts('https://example.test/a.js')[0].async).toBe(true);
    finish('https://example.test/a.js', 'load');
    await expect(first).resolves.toBeUndefined();
  });

  it('forgets a script that failed, so the next attempt tries again', async () => {
    const failed = loadScript('https://example.test/b.js');
    finish('https://example.test/b.js', 'error');
    await expect(failed).rejects.toThrow("Couldn't load https://example.test/b.js");
    expect(scripts('https://example.test/b.js')).toHaveLength(0);

    const retry = loadScript('https://example.test/b.js');
    expect(retry).not.toBe(failed);
    finish('https://example.test/b.js', 'load');
    await expect(retry).resolves.toBeUndefined();
  });
});

describe('provider scripts', () => {
  it('gives Google’s sign-in API once its script has loaded', async () => {
    const id = { initialize: vi.fn(), renderButton: vi.fn() } satisfies GoogleIdApi;
    const loaded = loadGoogle();
    window.google = { accounts: { id } };
    finish(GOOGLE_SCRIPT, 'load');
    await expect(loaded).resolves.toBe(id);
  });

  it('fails when Google’s script loads but doesn’t start', async () => {
    const loaded = loadGoogle();
    finish(GOOGLE_SCRIPT, 'load');
    await expect(loaded).rejects.toThrow('did not start');
  });

  it('gives Apple’s sign-in API once its script has loaded, and fails without it', async () => {
    const auth = { init: vi.fn(), signIn: vi.fn() } satisfies AppleAuthApi;
    const missing = loadApple();
    finish(APPLE_SCRIPT, 'load');
    await expect(missing).rejects.toThrow('did not start');

    window.AppleID = { auth };
    await expect(loadApple()).resolves.toBe(auth);
    expect(APPLE_SCRIPT).toContain('/en_GB/');
  });
});

describe('Facebook’s SDK', () => {
  const fb = { init: vi.fn(), login: vi.fn() } satisfies FacebookApi;

  it('waits for Facebook to say it’s ready, and loads its loader only once', async () => {
    const loaded = loadFacebook();
    expect(loadFacebook()).toBe(loaded);
    expect(scripts(FACEBOOK_SCRIPT)).toHaveLength(1);
    finish(FACEBOOK_SCRIPT, 'load');
    window.FB = fb;
    window.fbAsyncInit!();
    await expect(loaded).resolves.toBe(fb);
    expect(FACEBOOK_GRAPH_VERSION).toMatch(/^v\d+\.\d$/);
  });

  it('fails, and tries again next time, when the loader can’t load or the SDK never starts', async () => {
    const blocked = loadFacebook();
    finish(FACEBOOK_SCRIPT, 'error');
    await expect(blocked).rejects.toThrow("Couldn't load");

    const empty = loadFacebook();
    expect(empty).not.toBe(blocked);
    window.fbAsyncInit!();
    await expect(empty).rejects.toThrow('did not start');

    vi.useFakeTimers();
    try {
      const silent = loadFacebook();
      vi.advanceTimersByTime(FACEBOOK_READY_TIMEOUT_MS);
      await expect(silent).rejects.toThrow('did not start');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('nonces', () => {
  it('makes a random raw nonce and the hex SHA-256 the provider gets', async () => {
    const one = await makeNonce();
    const two = await makeNonce();
    expect(one.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(one.hashed).toBe(createHash('sha256').update(one.raw).digest('hex'));
    expect(two.raw).not.toBe(one.raw);
  });

  it('makes a random state', () => {
    expect(randomState()).toMatch(/^[0-9a-f]{32}$/);
    expect(randomState()).not.toBe(randomState());
  });
});
