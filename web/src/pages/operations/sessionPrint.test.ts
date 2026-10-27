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
const sheet = (sectionName: string) => ({ heatId: 1, label: 'Heat 1', sectionName, sessionName: 'Session 1', scheduledStart: null, races: [] });
const sheets: PrintableScoreSheets = { competition, heats: [sheet('Under 12'), sheet('Under 14'), sheet('')] };

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

  it('keeps the score sheets that match the session and section names', () => {
    expect(scoreSheetsForSession(sheets, draw, 6).heats.map((h) => h.sectionName)).toEqual(['Under 14']);
    expect(scoreSheetsForSession(sheets, draw, 99).heats).toEqual([]);
  });

  it('matches a session with no section to sheets with no section', () => {
    const open: PrintableDraw = { competition, sessions: [{ sessionId: 8, sectionName: '', sessionName: 'Session 1', arenaName: null, orderIndex: 3, heats: [] }] };
    expect(scoreSheetsForSession(sheets, open, 8).heats.map((h) => h.sectionName)).toEqual(['']);
  });
});
