import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { isSessionLocked } from './sessionLock';

const session = (over: Record<string, unknown> = {}, heats: unknown[] = []) => ({ status: 0, startedAt: null, heats, ...over }) as unknown as Session;
const heat = (over: Record<string, unknown> = {}, races: unknown[] = []) => ({ startedAt: null, finishedAt: null, races, ...over });

describe('isSessionLocked', () => {
  it('leaves a drawn session that has not started free to change', () => {
    expect(isSessionLocked(session())).toBe(false);
    expect(isSessionLocked(session({}, [heat({}, [{ isComplete: false }]), heat()]))).toBe(false);
  });

  it('locks a session that has started', () => {
    expect(isSessionLocked(session({ status: 1 }))).toBe(true);
    expect(isSessionLocked(session({ status: 2 }))).toBe(true);
    expect(isSessionLocked(session({ startedAt: '2030-06-01T10:00:00Z' }))).toBe(true);
  });

  it('locks a session with a running or finished heat, or any scored race', () => {
    expect(isSessionLocked(session({}, [heat({ startedAt: '2030-06-01T10:00:00Z' })]))).toBe(true);
    expect(isSessionLocked(session({}, [heat({ finishedAt: '2030-06-01T10:20:00Z' })]))).toBe(true);
    expect(isSessionLocked(session({}, [heat(), heat({}, [{ isComplete: true }])]))).toBe(true);
  });
});
