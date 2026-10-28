import { afterEach, describe, expect, it, vi } from 'vitest';
import { countVisit, dismissNudge, nudgeAllowedOn, nudgeDismissed, NUDGE_FROM_VISIT } from './installNudge';

afterEach(() => { vi.restoreAllMocks(); });

describe('nudgeAllowedOn', () => {
  it('allows ordinary pages', () => {
    for (const path of ['/', '/events', '/competitions/4', '/competitions/4/scoring', '/competitions/4/teams/7', '/me', '/teams']) {
      expect(nudgeAllowedOn(path)).toBe(true);
    }
  });

  it('keeps off kiosks, camera, scoring, message pages, Settings and pages outside the shell', () => {
    for (const path of ['/embed/competitions/4', '/score', '/login', '/settings', '/competitions/4/tv', '/competitions/4/broadcast',
      '/competitions/4/produce', '/competitions/4/stream-controls', '/competitions/4/commentary', '/competitions/4/session/9',
      '/competitions/4/chat', '/competitions/4/messages/abc', '/competitions/4/enter/team']) {
      expect(nudgeAllowedOn(path)).toBe(false);
    }
  });
});

describe('countVisit', () => {
  it('counts once per browser session', () => {
    expect(countVisit()).toBe(1);
    expect(countVisit()).toBe(1);
    sessionStorage.clear();
    expect(countVisit()).toBe(2);
    sessionStorage.clear();
    expect(countVisit()).toBe(NUDGE_FROM_VISIT);
    expect(localStorage.getItem('mg.install.visits')).toBe('3');
  });

  it('starts again from a stored count that is not a number', () => {
    localStorage.setItem('mg.install.visits', 'lots');
    expect(countVisit()).toBe(1);
  });

  it('counts nothing when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(countVisit()).toBe(0);
  });
});

describe('dismissing', () => {
  it('remembers the card was put away', () => {
    expect(nudgeDismissed()).toBe(false);
    dismissNudge();
    expect(nudgeDismissed()).toBe(true);
  });

  it('counts unreadable storage as put away, and ignores a failed write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => dismissNudge()).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(nudgeDismissed()).toBe(true);
  });
});
