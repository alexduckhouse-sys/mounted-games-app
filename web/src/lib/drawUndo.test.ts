import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAW_UNDO_STATUS,
  drawUndoActionLabel,
  drawUndoBannerDescription,
  formatUndoWindowRemaining,
  isDrawUndoActive,
  parseDrawUndoResult,
  parseDrawUndoStatus,
} from './drawUndo';

describe('drawUndo helpers', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');

  it('parses valid undo status and rejects inactive payloads', () => {
    expect(parseDrawUndoStatus(null)).toEqual(EMPTY_DRAW_UNDO_STATUS);
    expect(parseDrawUndoStatus({ available: false })).toEqual(EMPTY_DRAW_UNDO_STATUS);

    const status = parseDrawUndoStatus({
      available: true,
      undoId: 42,
      kind: 'DeleteHeat',
      label: 'Deleted Heat 2 in Session 1',
      sectionId: 3,
      sessionId: 9,
      createdAt: '2026-10-26T11:55:00Z',
      expiresAt: '2026-10-26T12:25:00Z',
      affectedHeats: 3,
      affectedSessions: 1,
    });
    expect(status.available).toBe(true);
    expect(status.undoId).toBe(42);
    expect(status.kind).toBe('DeleteHeat');
    expect(isDrawUndoActive(status, now)).toBe(true);
    expect(isDrawUndoActive(status, Date.parse('2026-10-26T12:30:00Z'))).toBe(false);
  });

  it('formats remaining minutes and banner labels', () => {
    const deleteStatus = parseDrawUndoStatus({
      available: true,
      kind: 'DeleteHeat',
      label: 'Deleted Heat 2 in Session 1',
      expiresAt: '2026-10-26T12:25:00Z',
      affectedHeats: 2,
      affectedSessions: 1,
    });
    expect(formatUndoWindowRemaining(deleteStatus, now)).toBe('25m left');
    expect(drawUndoActionLabel(deleteStatus)).toBe('Restore Deleted Heat');
    expect(drawUndoBannerDescription(deleteStatus, now)).toBe('Deleted Heat 2 in Session 1 (2 heats · 25m left)');

    const redrawStatus = parseDrawUndoStatus({
      available: true,
      kind: 'SectionDraw',
      label: 'Draw for Under 17',
      affectedHeats: 1,
      affectedSessions: 1,
    });
    expect(drawUndoActionLabel(redrawStatus)).toBe('Undo Last Redraw');
    expect(drawUndoBannerDescription(redrawStatus, now)).toBe('Draw for Under 17 (1 heat)');
  });

  it('parses DrawUndoResult payloads', () => {
    expect(parseDrawUndoResult(null)).toBeNull();
    const res = parseDrawUndoResult({
      restored: true,
      label: 'Deleted Heat 2 in Session 1',
      restoredSessions: 1,
      restoredHeats: 2,
      undoStatus: { available: false },
    });
    expect(res).toEqual({
      restored: true,
      label: 'Deleted Heat 2 in Session 1',
      restoredSessions: 1,
      restoredHeats: 2,
      undoStatus: EMPTY_DRAW_UNDO_STATUS,
    });
  });
});
