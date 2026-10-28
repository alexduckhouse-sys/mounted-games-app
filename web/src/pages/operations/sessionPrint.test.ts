import { describe, expect, it } from 'vitest';
import { drawForSession, parseSessionId, scoreSheetsForSession, sessionPrintPath } from './sessionPrint';
import type { PrintableDraw, PrintableScoreSheets } from '../eventTools/eventToolsTypes';

const competition = { id: 1, name: 'Show', location: null, startDate: '2026-06-01T09:00:00Z', endDate: null };
const draw: PrintableDraw = {
  competition,
  sessions: [
    { sessionId: 5, sectionName: 'Under 12', sessionName: 'Session 1', arenaName: null, orderIndex: 1, heats: [] },
    { sessionId: 6, sectionName: 'Under 14', sessionName: 'Session 1', arenaName: null, orderIndex: 2, heats: [] },
  ],
};
const sheet = (sectionName: string, sessionId: number) => ({ heatId: 1, label: 'Heat 1', sectionName, sessionName: 'Session 1', sessionId, scheduledStart: null, races: [] });
const sheets: PrintableScoreSheets = { competition, heats: [sheet('Under 12', 5), sheet('Under 14', 6), sheet('', 8), sheet('Under 14', 9)] };

describe('session print helpers', () => {
  it('reads a whole positive session id only', () => {
    expect(parseSessionId('12')).toBe(12);
    expect(parseSessionId(' 7 ')).toBe(7);
    expect(parseSessionId('0')).toBeNull();
    expect(parseSessionId('1.5')).toBeNull();
    expect(parseSessionId('abc')).toBeNull();
    expect(parseSessionId(null)).toBeNull();
    expect(parseSessionId(undefined)).toBeNull();
  });

  it('builds the print address', () => {
    expect(sessionPrintPath(3, 'draw', 9)).toBe('/event-tools/3/print/draw?sessionId=9');
  });

  it('keeps one session of the draw', () => {
    expect(drawForSession(draw, 6).sessions.map((s) => s.sessionId)).toEqual([6]);
    expect(drawForSession(draw, 99).sessions).toEqual([]);
  });

  it('keeps the score sheets of the session by id, even when another session shares its name', () => {
    expect(scoreSheetsForSession(sheets, 6).heats.map((h) => h.sectionName)).toEqual(['Under 14']);
    expect(scoreSheetsForSession(sheets, 9).heats).toHaveLength(1);
    expect(scoreSheetsForSession(sheets, 99).heats).toEqual([]);
    expect(scoreSheetsForSession(sheets, 8).heats.map((h) => h.sectionName)).toEqual(['']);
  });
});
