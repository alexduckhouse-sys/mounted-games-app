import { describe, expect, it } from 'vitest';
import type { PrintableResults, PrintableScoreHeat, PrintableSession } from '../pages/eventTools/eventToolsTypes';
import type { PrintableSessionSummary } from '../types';
import {
  buildCompletedSessionNoticeboardSheet,
  buildSessionSelectorOptions,
  filterPrintableDrawSessions,
  filterPrintableHeatsBySession,
  isPrintableHeatCompleted,
} from './sessionPrintSheet';

const loose = <T,>(v: unknown) => v as T;

const cell = (extra: Record<string, unknown> = {}) => ({ placing: null, eliminated: false, points: 0, ...extra });

const heat = (sessionName: string, sectionName: string, teams: unknown[][] | null, id = 1) =>
  loose<PrintableScoreHeat>({
    id,
    sessionName,
    sectionName,
    races: teams === null ? undefined : teams.map((t) => ({ teams: t })),
  });

const done = (sessionName: string, sectionName = 'Open', id = 1) => heat(sessionName, sectionName, [[cell({ placing: 1 })]], id);
const todo = (sessionName: string, sectionName = 'Open', id = 1) => heat(sessionName, sectionName, [[cell()]], id);

describe('isPrintableHeatCompleted', () => {
  it('needs races, and every race to have a scored cell of some kind', () => {
    expect(isPrintableHeatCompleted(heat('S', 'A', null))).toBe(false);
    expect(isPrintableHeatCompleted(heat('S', 'A', []))).toBe(false);
    expect(isPrintableHeatCompleted(heat('S', 'A', [[cell({ eliminated: true })]]))).toBe(true);
    expect(isPrintableHeatCompleted(heat('S', 'A', [[cell({ isSitOut: true })]]))).toBe(true);
    expect(isPrintableHeatCompleted(heat('S', 'A', [[cell({ points: 3 })]]))).toBe(true);
    expect(isPrintableHeatCompleted(heat('S', 'A', [[cell({ points: 0 })]]))).toBe(false);
    expect(isPrintableHeatCompleted(heat('S', 'A', [[cell({ points: null })]]))).toBe(false);
    expect(isPrintableHeatCompleted(heat('S', 'A', [[cell({ placing: 2 })], [cell()]]))).toBe(false);
  });
});

describe('buildSessionSelectorOptions', () => {
  it('defaults to a single empty "All Sessions" option', () => {
    const [all, ...rest] = buildSessionSelectorOptions();
    expect(rest).toEqual([]);
    expect(all).toMatchObject({ value: 'all', totalHeats: 0, completedHeats: 0, isCompleted: false });
  });

  it('prefers backend summaries and labels completed, partial and untouched sessions', () => {
    const summaries = loose<PrintableSessionSummary[]>([
      { sessionId: 1, sessionName: 'S1', sectionName: 'Open', totalHeats: 4, completedHeats: 4, isCompleted: true },
      { sessionId: 2, sessionName: 'S2', sectionName: '', totalHeats: 4, completedHeats: 1, isCompleted: false },
      { sessionId: 3, sessionName: 'S3', sectionName: 'U12', totalHeats: 4, completedHeats: 0, isCompleted: false },
      { sessionId: 4, sessionName: 'S4', sectionName: '', totalHeats: 2, completedHeats: 0, isCompleted: false },
    ]);
    const opts = buildSessionSelectorOptions([done('Ignored')], [], summaries);
    expect(opts.map((o) => o.label)).toEqual([
      'All Sessions',
      'S1 · Open (Completed)',
      'S2 (1/4 heats)',
      'S3 · U12',
      'S4',
    ]);
    expect(opts[0]).toMatchObject({ totalHeats: 1, completedHeats: 1, isCompleted: true });
  });

  it('groups heats by session name, seeding names from draw sessions first', () => {
    const draw = loose<PrintableSession[]>([
      { sessionId: 7, sessionName: 'Draw only', sectionName: 'Pre' },
      { sessionId: 8, sessionName: 'Both', sectionName: 'Mixed' },
      { sessionId: 99, sessionName: 'Both', sectionName: 'Duplicate ignored' },
    ]);
    const opts = buildSessionSelectorOptions(
      [
        done('Both', 'Mixed', 1),
        todo('Both', 'Mixed', 2),
        done('Heats only', '', 3),
        todo('Pending', 'Open', 4),
        done('Finished', 'Open', 5),
      ],
      draw,
    );
    const byValue = Object.fromEntries(opts.map((o) => [o.value, o]));
    expect(byValue['Draw only']).toMatchObject({ sessionId: 7, totalHeats: 0, isCompleted: false, label: 'Draw only · Pre' });
    expect(byValue['Both']).toMatchObject({ sessionId: 8, totalHeats: 2, completedHeats: 1, label: 'Both · Mixed (1/2 heats)' });
    expect(byValue['Heats only']).toMatchObject({ sessionId: null, isCompleted: true, label: 'Heats only (Completed)' });
    expect(byValue['Pending'].label).toBe('Pending · Open');
    expect(byValue['Finished'].label).toBe('Finished · Open (Completed)');
    expect(opts[0]).toMatchObject({ totalHeats: 5, completedHeats: 3, isCompleted: false });
  });
});

describe('session filters', () => {
  const heats = [done('A', 'Open', 1), done('B', 'Open', 2)];
  const sessions = loose<PrintableSession[]>([{ sessionName: 'A' }, { sessionName: 'B' }]);

  it('returns copies of everything for an empty or "all" selection', () => {
    expect(filterPrintableHeatsBySession(heats, '')).toEqual(heats);
    expect(filterPrintableHeatsBySession(heats, 'all')).not.toBe(heats);
    expect(filterPrintableDrawSessions(sessions, '')).toHaveLength(2);
    expect(filterPrintableDrawSessions(sessions, 'all')).not.toBe(sessions);
  });

  it('narrows to the named session', () => {
    expect(filterPrintableHeatsBySession(heats, 'B').map((h) => (h as unknown as { id: number }).id)).toEqual([2]);
    expect(filterPrintableDrawSessions(sessions, 'A')).toHaveLength(1);
    expect(filterPrintableDrawSessions(sessions, 'missing')).toEqual([]);
  });
});

describe('buildCompletedSessionNoticeboardSheet', () => {
  const results = loose<PrintableResults>({
    sections: [{ sectionName: 'Open' }, { sectionName: 'U12' }, { sectionName: 'Other' }],
  });

  it('returns null without results', () => {
    expect(buildCompletedSessionNoticeboardSheet(null, [], 'all')).toBeNull();
    expect(buildCompletedSessionNoticeboardSheet(undefined, [], 'all')).toBeNull();
  });

  it('picks the latest completed session when nothing is selected', () => {
    const sheet = buildCompletedSessionNoticeboardSheet(results, [done('S1', 'Open', 1), done('S2', 'U12', 2), todo('S3', 'Other', 3)], '');
    expect(sheet).toMatchObject({ sessionName: 'S2', sectionNames: ['U12'], isCompleted: true, completedHeatsCount: 1, totalHeatsCount: 1 });
    expect(sheet?.sections.map((s) => s.sectionName)).toEqual(['U12']);
  });

  it('falls back to the latest session with any results, then to the first session', () => {
    const partial = buildCompletedSessionNoticeboardSheet(
      results,
      [todo('S1', 'Open', 1), done('S2', 'Open', 2), todo('S2', 'Open', 3)],
      'all',
    );
    expect(partial).toMatchObject({ sessionName: 'S2', isCompleted: false, completedHeatsCount: 1, totalHeatsCount: 2 });
    expect(partial?.heats).toHaveLength(1);

    const none = buildCompletedSessionNoticeboardSheet(results, [todo('S1', 'Open', 1), todo('S2', 'Open', 2)], 'all');
    expect(none).toMatchObject({ sessionName: 'S1', isCompleted: false, completedHeatsCount: 0 });
    expect(none?.heats).toHaveLength(1); // nothing completed, so print all of the session's heats
  });

  it('labels an empty event "All Sessions" and keeps every section when no section names exist', () => {
    const sheet = buildCompletedSessionNoticeboardSheet(results, [], 'all');
    expect(sheet).toMatchObject({ sessionName: 'All Sessions', sectionNames: [], isCompleted: false, totalHeatsCount: 0 });
    expect(sheet?.sections).toHaveLength(3);
    const blank = buildCompletedSessionNoticeboardSheet(results, [done('S', '  ', 1)], 'S');
    expect(blank?.sectionNames).toEqual([]);
    expect(blank?.sections).toHaveLength(3);
  });

  it('uses an explicitly selected session', () => {
    const sheet = buildCompletedSessionNoticeboardSheet(results, [done('S1', 'Open', 1), done('S2', 'U12', 2)], 'S1');
    expect(sheet?.sessionName).toBe('S1');
    expect(sheet?.sectionNames).toEqual(['Open']);
  });
});
