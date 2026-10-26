import { describe, expect, it } from 'vitest';
import { heat, race, session } from '../test/factories';
import { formatTime } from './time';
import { ageGroupStatuses } from './ageGroupStatus';

const start = new Date('2026-06-01T09:05:00');

describe('ageGroupStatuses', () => {
  it('marks an age group live while one of its heats is on', () => {
    const sessions = [session(1, { competitionSectionId: 5, status: 1, scheduledStart: start.toISOString(), heats: [heat(1)] })];
    expect(ageGroupStatuses(sessions, [5]).get(5)).toMatchObject({ live: true });
  });

  it('gives the time of the next heat that has not started', () => {
    const sessions = [session(1, { competitionSectionId: 6, scheduledStart: start.toISOString(), heats: [heat(1), heat(2)] })];
    expect(ageGroupStatuses(sessions, [6]).get(6)).toEqual({ live: false, next: formatTime(start) });
  });

  it('has no next time once every heat is finished, or when the age group has no heats', () => {
    const sessions = [session(1, { competitionSectionId: 5, status: 2, scheduledStart: start.toISOString(), heats: [heat(1, { races: [race(1, { isComplete: true })] })] })];
    const result = ageGroupStatuses(sessions, [5, 9]);
    expect(result.get(5)).toEqual({ live: false, next: null });
    expect(result.get(9)).toEqual({ live: false, next: null });
  });
});
