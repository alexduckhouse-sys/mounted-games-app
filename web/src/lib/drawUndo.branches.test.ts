import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_DRAW_UNDO_STATUS,
  drawUndoActionLabel,
  drawUndoBannerDescription,
  formatUndoWindowRemaining,
  isDrawUndoActive,
  parseDrawUndoResult,
  parseDrawUndoStatus,
} from './drawUndo';
import type { DrawUndoStatus } from '../types';

const base: DrawUndoStatus = { ...EMPTY_DRAW_UNDO_STATUS, available: true, affectedHeats: 2 };
const now = Date.parse('2026-10-26T12:00:00Z');

describe('drawUndo branches', () => {
  it('coerces wrongly typed fields to null/0 and rejects arrays', () => {
    expect(parseDrawUndoStatus([])).toEqual(EMPTY_DRAW_UNDO_STATUS);
    const s = parseDrawUndoStatus({
      available: true,
      undoId: '1',
      kind: 5,
      label: 6,
      sectionId: 'x',
      sessionId: null,
      createdAt: 1,
      expiresAt: 2,
      affectedHeats: -1,
      affectedSessions: 'many',
    });
    expect(s).toEqual({ ...EMPTY_DRAW_UNDO_STATUS, available: true });
  });

  it('checks the active window', () => {
    expect(isDrawUndoActive(null)).toBe(false);
    expect(isDrawUndoActive(undefined)).toBe(false);
    expect(isDrawUndoActive(EMPTY_DRAW_UNDO_STATUS)).toBe(false);
    expect(isDrawUndoActive(base, now)).toBe(true);
    expect(isDrawUndoActive({ ...base, expiresAt: 'garbage' }, now)).toBe(true);
    expect(isDrawUndoActive({ ...base, expiresAt: '2026-10-26T12:10:00Z' }, now)).toBe(true);
    expect(isDrawUndoActive({ ...base, expiresAt: '2026-10-26T11:59:00Z' }, now)).toBe(false);
    expect(isDrawUndoActive(base)).toBe(true);
  });

  it('formats remaining time', () => {
    expect(formatUndoWindowRemaining(null)).toBe('');
    expect(formatUndoWindowRemaining(EMPTY_DRAW_UNDO_STATUS)).toBe('');
    expect(formatUndoWindowRemaining(base, now)).toBe('');
    expect(formatUndoWindowRemaining({ ...base, expiresAt: 'bad' }, now)).toBe('');
    expect(formatUndoWindowRemaining({ ...base, expiresAt: '2026-10-26T11:00:00Z' }, now)).toBe('Expired');
    expect(formatUndoWindowRemaining({ ...base, expiresAt: '2026-10-26T12:00:01Z' }, now)).toBe('1m left');
    expect(formatUndoWindowRemaining({ ...base, expiresAt: '2026-10-26T12:28:00Z' }, now)).toBe('28m left');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(formatUndoWindowRemaining({ ...base, expiresAt: '2026-10-26T12:02:00Z' })).toBe('2m left');
  });

  it('picks the action label per kind', () => {
    const generic = 'Undo Last Redraw / Restore Deleted Heat';
    expect(drawUndoActionLabel(null)).toBe(generic);
    expect(drawUndoActionLabel(EMPTY_DRAW_UNDO_STATUS)).toBe(generic);
    expect(drawUndoActionLabel({ ...base, kind: 'DeleteHeat' })).toBe('Restore Deleted Heat');
    expect(drawUndoActionLabel({ ...base, kind: 'ClearHeats' })).toBe('Restore Deleted Heat');
    for (const kind of ['SectionDraw', 'GenerateHeats', 'GenerateRaceFinals']) {
      expect(drawUndoActionLabel({ ...base, kind })).toBe('Undo Last Redraw');
    }
    expect(drawUndoActionLabel({ ...base, kind: 'Other' })).toBe(generic);
  });

  it('describes the banner with label fallbacks, singular heat and optional remaining time', () => {
    expect(drawUndoBannerDescription(null)).toBe('');
    expect(drawUndoBannerDescription(EMPTY_DRAW_UNDO_STATUS)).toBe('');
    expect(drawUndoBannerDescription(base, now)).toBe('Last draw or heat change (2 heats)');
    expect(drawUndoBannerDescription({ ...base, label: '   ', affectedHeats: 1 }, now)).toBe(
      'Last draw or heat change (1 heat)',
    );
    expect(
      drawUndoBannerDescription({ ...base, label: ' Redraw ', expiresAt: '2026-10-26T12:05:00Z' }, now),
    ).toBe('Redraw (2 heats · 5m left)');
    expect(drawUndoBannerDescription(base)).toBe('Last draw or heat change (2 heats)');
  });

  it('parses restore results with defaults', () => {
    expect(parseDrawUndoResult(null)).toBeNull();
    expect(parseDrawUndoResult({ restored: false })).toBeNull();
    expect(parseDrawUndoResult({ restored: true })).toEqual({
      restored: true,
      label: 'Restored previous heat state',
      restoredSessions: 0,
      restoredHeats: 0,
      undoStatus: EMPTY_DRAW_UNDO_STATUS,
    });
    expect(
      parseDrawUndoResult({ restored: true, label: 'L', restoredSessions: 2, restoredHeats: 3, undoStatus: { available: true } }),
    ).toMatchObject({ label: 'L', restoredSessions: 2, restoredHeats: 3, undoStatus: { available: true } });
  });
});
