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

type Cell = PrintableScoreHeat['races'][number]['teams'][number];
const cell = (over: Partial<Cell> = {}): Cell => ({
  teamId: 1,
  teamName: 'A',
  placing: null,
  eliminated: false,
  points: null,
  lane: 1,
  ...over,
});
const heat = (id: number, session: string, section: string, teams: Cell[][]): PrintableScoreHeat => ({
  heatId: id,
  label: `Heat ${id}`,
  sectionName: section,
  sessionName: session,
  scheduledStart: null,
  races: teams.map((t, i) => ({ raceId: id * 10 + i, name: `R${i}`, teams: t })),
});

const results: PrintableResults = {
  competition: { id: 1, name: 'C', location: '', startDate: '2026-05-01T00:00:00Z', endDate: null },
  isProvisional: false,
  sections: [
    { competitionSectionId: 1, sectionName: 'U17', results: [] },
    { competitionSectionId: 2, sectionName: 'Open', results: [] },
  ],
};

describe('sessionPrintSheet branches', () => {
  it('treats a heat as incomplete without races and completes on each scoring signal', () => {
    expect(isPrintableHeatCompleted(heat(1, 'S', 'U17', []))).toBe(false);
    expect(isPrintableHeatCompleted(heat(1, 'S', 'U17', [[cell({ eliminated: true })]]))).toBe(true);
    expect(isPrintableHeatCompleted(heat(1, 'S', 'U17', [[cell({ isSitOut: true })]]))).toBe(true);
    expect(isPrintableHeatCompleted(heat(1, 'S', 'U17', [[cell({ points: 3 })]]))).toBe(true);
    expect(isPrintableHeatCompleted(heat(1, 'S', 'U17', [[cell({ points: 0 })]]))).toBe(false);
    // every race must be scored
    expect(isPrintableHeatCompleted(heat(1, 'S', 'U17', [[cell({ placing: 1 })], [cell()]]))).toBe(false);
  });

  it('builds options from backend summaries with each suffix and label shape', () => {
    const summaries: PrintableSessionSummary[] = [
      { sessionId: 1, sessionName: 'S1', sectionName: 'U17', orderIndex: 0, totalHeats: 2, completedHeats: 2, isCompleted: true },
      { sessionId: 2, sessionName: 'S2', sectionName: 'Open', orderIndex: 1, totalHeats: 4, completedHeats: 1, isCompleted: false },
      { sessionId: 3, sessionName: 'S3', sectionName: '', orderIndex: 2, totalHeats: 4, completedHeats: 0, isCompleted: false },
      { sessionId: 4, sessionName: 'S4', sectionName: '', orderIndex: 3, totalHeats: 2, completedHeats: 2, isCompleted: true },
    ];
    const opts = buildSessionSelectorOptions([], [], summaries);
    expect(opts.map((o) => o.label)).toEqual([
      'All Sessions',
      'S1 · U17 (Completed)',
      'S2 · Open (1/4 heats)',
      'S3',
      'S4 (Completed)',
    ]);
    expect(opts[0].isCompleted).toBe(false);
    expect(opts[2].sessionId).toBe(2);
  });

  it('merges draw sessions with heats, keeping unknown sessions and partial progress', () => {
    const drawSessions: PrintableSession[] = [
      { sessionId: 9, sectionName: 'U17', sessionName: 'Draw S', arenaName: null, orderIndex: 0, heats: [] },
      { sessionId: 10, sectionName: 'U17', sessionName: 'Draw S', arenaName: null, orderIndex: 1, heats: [] },
    ];
    const heats = [
      heat(1, 'Draw S', 'U17', [[cell({ placing: 1 })]]),
      heat(2, 'Draw S', 'U17', [[cell()]]),
      heat(3, 'Other', '', [[cell({ placing: 1 })]]),
    ];
    const opts = buildSessionSelectorOptions(heats, drawSessions);
    const draw = opts.find((o) => o.value === 'Draw S')!;
    expect(draw.sessionId).toBe(9);
    expect(draw.label).toBe('Draw S · U17 (1/2 heats)');
    const other = opts.find((o) => o.value === 'Other')!;
    expect(other.sessionId).toBeNull();
    expect(other.label).toBe('Other (Completed)');
    expect(opts[0].isCompleted).toBe(false);

    // draw session without heats: zero totals, never complete, no suffix
    const empty = buildSessionSelectorOptions([], drawSessions).find((o) => o.value === 'Draw S')!;
    expect(empty.totalHeats).toBe(0);
    expect(empty.isCompleted).toBe(false);
    expect(empty.label).toBe('Draw S · U17');
    // default args
    expect(buildSessionSelectorOptions()).toHaveLength(1);
  });

  it('filters draw sessions and handles empty / all selectors', () => {
    const ds: PrintableSession[] = [
      { sessionId: 1, sectionName: 'a', sessionName: 'A', arenaName: null, orderIndex: 0, heats: [] },
      { sessionId: 2, sectionName: 'b', sessionName: 'B', arenaName: null, orderIndex: 1, heats: [] },
    ];
    expect(filterPrintableDrawSessions(ds, 'B').map((s) => s.sessionId)).toEqual([2]);
    expect(filterPrintableDrawSessions(ds, 'all')).toHaveLength(2);
    expect(filterPrintableDrawSessions(ds, '')).toHaveLength(2);
    expect(filterPrintableHeatsBySession([], '')).toEqual([]);
  });

  it('returns null without results and falls back through latest-completed, latest-with-results and first', () => {
    expect(buildCompletedSessionNoticeboardSheet(null, [], 'all')).toBeNull();
    expect(buildCompletedSessionNoticeboardSheet(undefined, [], 'all')).toBeNull();

    // no heats at all: target 'all', all sections kept, nothing complete
    const none = buildCompletedSessionNoticeboardSheet(results, [], '')!;
    expect(none.sessionName).toBe('All Sessions');
    expect(none.isCompleted).toBe(false);
    expect(none.sections).toHaveLength(2);
    expect(none.sectionNames).toEqual([]);

    // partial progress picks the latest session with results and prints only completed heats
    const partial = [
      heat(1, 'S1', 'U17', [[cell()]]),
      heat(2, 'S2', 'Open', [[cell({ placing: 1 })]]),
      heat(3, 'S2', 'Open', [[cell()]]),
    ];
    const p = buildCompletedSessionNoticeboardSheet(results, partial, 'all')!;
    expect(p.sessionName).toBe('S2');
    expect(p.isCompleted).toBe(false);
    expect(p.completedHeatsCount).toBe(1);
    expect(p.totalHeatsCount).toBe(2);
    expect(p.heats.map((h) => h.heatId)).toEqual([2]);
    expect(p.sections.map((s) => s.sectionName)).toEqual(['Open']);

    // nothing scored: first session, prints all of its heats
    const unscored = [heat(1, 'S1', 'U17', [[cell()]]), heat(2, 'S2', 'Open', [[cell()]])];
    const u = buildCompletedSessionNoticeboardSheet(results, unscored, 'all')!;
    expect(u.sessionName).toBe('S1');
    expect(u.heats.map((h) => h.heatId)).toEqual([1]);

    // explicit session with a blank section name keeps every section
    const blank = [heat(1, 'S1', '  ', [[cell({ placing: 1 })]])];
    const b = buildCompletedSessionNoticeboardSheet(results, blank, 'S1')!;
    expect(b.sectionNames).toEqual([]);
    expect(b.sections).toHaveLength(2);
    expect(b.isCompleted).toBe(true);
  });
});
