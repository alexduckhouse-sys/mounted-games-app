import { describe, expect, it } from 'vitest';
import { GRACE_MS, OFFLINE_GRACE_MS, RECONNECT_MS, isFocusPage, liveState, pollIntervalMs, type ConnectionInputs } from './connectionStatus';

const base: ConnectionInputs = { connected: false, online: true, failures: 0, downSince: 1_000_000, everConnected: true };

describe('isFocusPage', () => {
  it('treats heat and scoring pages as needing fresh results', () => {
    expect(isFocusPage('/competitions/4/session/12')).toBe(true);
    expect(isFocusPage('/competitions/4/session/12/')).toBe(true);
    expect(isFocusPage('/competitions/4/scoring')).toBe(true);
  });

  it('leaves other pages at the normal pace', () => {
    expect(isFocusPage('/competitions/4')).toBe(false);
    expect(isFocusPage('/competitions/4/toplists')).toBe(false);
    expect(isFocusPage('/competitions/4/session')).toBe(false);
  });
});

describe('pollIntervalMs', () => {
  it('checks every 15 s on focus pages and 30 s elsewhere', () => {
    expect(pollIntervalMs(true, 0)).toBe(15_000);
    expect(pollIntervalMs(false, 2)).toBe(30_000);
  });

  it('backs off to 60 s after three failures in a row', () => {
    expect(pollIntervalMs(true, 3)).toBe(60_000);
    expect(pollIntervalMs(false, 7)).toBe(60_000);
  });
});

describe('liveState', () => {
  it('is live while connected, whatever else is going on', () => {
    expect(liveState({ ...base, connected: true, online: false, failures: 4 }, 0)).toBe('live');
  });

  it('is offline once the device has had no network for a few seconds', () => {
    expect(liveState({ ...base, online: false }, base.downSince! + OFFLINE_GRACE_MS - 1)).toBe('connecting');
    expect(liveState({ ...base, online: false }, base.downSince! + OFFLINE_GRACE_MS)).toBe('offline');
    expect(liveState({ ...base, online: false, everConnected: false }, base.downSince! + RECONNECT_MS)).toBe('offline');
  });

  it('does not call a failed timetable check offline while the live link is still within its grace', () => {
    expect(liveState({ ...base, failures: 1 }, base.downSince! + GRACE_MS - 1)).toBe('connecting');
    expect(liveState({ ...base, failures: 2, everConnected: false }, base.downSince!)).toBe('connecting');
  });

  it('is offline when checks are failing and the live link has stayed down', () => {
    expect(liveState({ ...base, failures: 1 }, base.downSince! + GRACE_MS)).toBe('offline');
    expect(liveState({ ...base, failures: 3 }, base.downSince! + RECONNECT_MS)).toBe('offline');
  });

  it('rides out routine reconnects and a cold start without a pill', () => {
    expect(GRACE_MS).toBeGreaterThanOrEqual(10_000);
    expect(RECONNECT_MS).toBeGreaterThan(GRACE_MS);
    expect(liveState(base, base.downSince! + 9_000)).toBe('connecting');
    expect(liveState({ ...base, everConnected: false }, base.downSince! + 9_000)).toBe('connecting');
  });

  it('stays quiet for a short drop or the first connect', () => {
    expect(liveState(base, base.downSince! + GRACE_MS - 1)).toBe('connecting');
    expect(liveState({ ...base, downSince: null }, 0)).toBe('connecting');
  });

  it('says it is reconnecting after a drop, then that it is checking', () => {
    expect(liveState(base, base.downSince! + GRACE_MS)).toBe('reconnecting');
    expect(liveState(base, base.downSince! + RECONNECT_MS)).toBe('polling');
  });

  it('goes straight to checking when the live link never worked', () => {
    expect(liveState({ ...base, everConnected: false }, base.downSince! + GRACE_MS)).toBe('polling');
  });
});
