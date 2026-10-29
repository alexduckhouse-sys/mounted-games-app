import { describe, expect, it } from 'vitest';
import { stageAction, stageCounts, stageOf } from './adminStage';

const now = new Date(2026, 9, 24, 12, 0);
const comp = (extra: Partial<Parameters<typeof stageOf>[0]> = {}) => ({
  startDate: new Date(2026, 10, 7).toISOString(), endDate: null, isArchived: false, sectionCount: 0, teamCount: 0, sessionCount: 0, ...extra,
});

describe('stageOf', () => {
  it('walks from draft to entries open, set format and ready to run', () => {
    expect(stageOf(comp(), now)).toBe('draft');
    expect(stageOf(comp({ sectionCount: 3 }), now)).toBe('entries');
    expect(stageOf(comp({ sectionCount: 3, teamCount: 12 }), now)).toBe('format');
    expect(stageOf(comp({ sectionCount: 3, teamCount: 12, sessionCount: 4 }), now)).toBe('ready');
  });

  it('does not count sessions that have no heats yet as a timetable', () => {
    const planned = { sectionCount: 3, teamCount: 12, sessionCount: 4 };
    expect(stageOf(comp({ ...planned, heatedSessionCount: 0 }), now)).toBe('format');
    expect(stageOf(comp({ ...planned, teamCount: 0, heatedSessionCount: 0 }), now)).toBe('entries');
    expect(stageOf(comp({ ...planned, heatedSessionCount: 2 }), now)).toBe('ready');
  });

  it('is live on the day, including the second day of a two-day event', () => {
    const base = { sectionCount: 3, teamCount: 12, sessionCount: 4 };
    expect(stageOf(comp({ ...base, startDate: new Date(2026, 9, 24, 9).toISOString() }), now)).toBe('live');
    expect(stageOf(comp({ ...base, startDate: new Date(2026, 9, 23).toISOString(), endDate: new Date(2026, 9, 24).toISOString() }), now)).toBe('live');
  });

  it('is finished once it has ended, or when archived', () => {
    expect(stageOf(comp({ startDate: new Date(2026, 9, 1).toISOString(), sessionCount: 4 }), now)).toBe('finished');
    expect(stageOf(comp({ isArchived: true }), now)).toBe('finished');
    expect(stageOf(comp({ startDate: new Date(2026, 9, 22).toISOString(), endDate: new Date(2026, 9, 23).toISOString() }), now)).toBe('finished');
  });

  it('copes with a date it cannot read', () => {
    expect(stageOf(comp({ startDate: 'whenever', sectionCount: 1 }), now)).toBe('entries');
    expect(stageOf(comp({ startDate: 'whenever', sessionCount: 1 }), now)).toBe('ready');
  });
});

describe('stageAction and stageCounts', () => {
  it('offers the next job for each stage', () => {
    expect(stageAction('live', 4)).toEqual({ label: 'Run day', to: '/competitions/4' });
    expect(stageAction('format', 4)).toEqual({ label: 'Before the day', to: '/competitions/4/operations' });
    expect(stageAction('ready', 4).label).toBe('Before the day');
    expect(stageAction('finished', 4)).toEqual({ label: 'Results', to: '/competitions/4/toplists' });
    expect(stageAction('entries', 4)).toEqual({ label: 'Edit', to: '/admin/competitions/4' });
    expect(stageAction('draft', 4).label).toBe('Edit');
  });

  it('counts upcoming and past', () => {
    expect(stageCounts(['live', 'entries', 'finished', 'finished', 'draft'])).toBe('3 upcoming · 2 past');
    expect(stageCounts([])).toBe('0 upcoming · 0 past');
  });
});
