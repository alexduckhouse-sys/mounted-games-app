import { describe, expect, it } from 'vitest';
import { assertNativeBuildEnv, nativeBuildEnvProblems } from './buildEnv';

const good = {
  VITE_API_BASE: 'https://mounted-games-app.vercel.app/api',
  VITE_LIVE_HUB_URL: 'https://mounted-games-api.vercel.app/hubs/live',
};

describe('nativeBuildEnvProblems', () => {
  it('accepts absolute https addresses', () => {
    expect(nativeBuildEnvProblems(good)).toEqual([]);
  });

  it('asks for both addresses when neither is set', () => {
    expect(nativeBuildEnvProblems({})).toEqual([
      'VITE_API_BASE is not set. The app needs an absolute https address.',
      'VITE_LIVE_HUB_URL is not set. The app needs an absolute https address.',
    ]);
  });

  it('treats a blank value as not set', () => {
    expect(nativeBuildEnvProblems({ ...good, VITE_API_BASE: '  ' })).toEqual(['VITE_API_BASE is not set. The app needs an absolute https address.']);
  });

  it('rejects the relative web defaults', () => {
    expect(nativeBuildEnvProblems({ ...good, VITE_API_BASE: '/api' })).toEqual(['VITE_API_BASE must be an absolute https address, not "/api".']);
  });

  it('rejects plain http', () => {
    expect(nativeBuildEnvProblems({ ...good, VITE_LIVE_HUB_URL: 'http://localhost:5050/hubs/live' })).toEqual(['VITE_LIVE_HUB_URL must use https, not http.']);
  });
});

describe('assertNativeBuildEnv', () => {
  it('passes quietly when the addresses are right', () => {
    expect(() => assertNativeBuildEnv(good)).not.toThrow();
  });

  it('lists every problem in one error', () => {
    expect(() => assertNativeBuildEnv({ VITE_API_BASE: '/api' })).toThrow(
      'The iPhone app build needs its server addresses:\n- VITE_API_BASE must be an absolute https address, not "/api".\n- VITE_LIVE_HUB_URL is not set. The app needs an absolute https address.',
    );
  });
});
