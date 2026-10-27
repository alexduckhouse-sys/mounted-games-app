import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAW_UNDO_STATUS, drawUndoActionLabel, drawUndoBannerDescription, formatUndoWindowRemaining,
  isDrawUndoActive, parseDrawUndoResult, parseDrawUndoStatus,
} from './drawUndo';
import type { DrawUndoStatus } from '../types';

const status = (over: Partial<DrawUndoStatus> = {}): DrawUndoStatus => ({ ...EMPTY_DRAW_UNDO_STATUS, available: true, ...over });
const NOW = Date.parse('2026-10-27T12:00:00Z');

describe('parseDrawUndoStatus', () => {
  it('returns the empty status for non-records and unavailable payloads', () => {
    for (const raw of [null, undefined, 'x', 4, [], { available: false }, { available: 'yes' }]) {
      expect(parseDrawUndoStatus(raw)).toBe(EMPTY_DRAW_UNDO_STATUS);
    }
  });

  it('keeps well-typed fields', () => {
    expect(parseDrawUndoStatus({
      available: true, undoId: 3, kind: 'DeleteHeat', label: 'L', sectionId: 4, sessionId: 5,
      createdAt: 'a', expiresAt: 'b', affectedHeats: 2, affectedSessions: 1,
    })).toEqual({
      available: true, undoId: 3, kind: 'DeleteHeat', label: 'L', sectionId: 4, sessionId: 5,
      createdAt: 'a', expiresAt: 'b', affectedHeats: 2, affectedSessions: 1,
    });
  });

  it('nulls wrongly-typed fields and clamps negative or non-numeric counts to zero', () => {
    expect(parseDrawUndoStatus({
      available: true, undoId: '3', kind: 1, label: 2, sectionId: 'x', sessionId: null,
      createdAt: 5, expiresAt: {}, affectedHeats: -1, affectedSessions: 'many',
    })).toEqual({ ...EMPTY_DRAW_UNDO_STATUS, available: true });
    expect(parseDrawUndoStatus({ available: true, affectedHeats: 'x', affectedSessions: -2 }).affectedSessions).toBe(0);
  });
});

describe('isDrawUndoActive', () => {
  it('is false for missing or unavailable status', () => {
    expect(isDrawUndoActive(null)).toBe(false);
    expect(isDrawUndoActive(undefined)).toBe(false);
    expect(isDrawUndoActive(EMPTY_DRAW_UNDO_STATUS)).toBe(false);
  });
  it('is true without an expiry or with an unparseable one', () => {
    expect(isDrawUndoActive(status(), NOW)).toBe(true);
    expect(isDrawUndoActive(status({ expiresAt: 'nonsense' }), NOW)).toBe(true);
  });
  it('compares the expiry with now', () => {
    expect(isDrawUndoActive(status({ expiresAt: '2026-10-27T12:10:00Z' }), NOW)).toBe(true);
    expect(isDrawUndoActive(status({ expiresAt: '2026-10-27T11:59:00Z' }), NOW)).toBe(false);
  });
  it('defaults now to the clock', () => {
    expect(isDrawUndoActive(status({ expiresAt: '2000-01-01T00:00:00Z' }))).toBe(false);
  });
});

describe('formatUndoWindowRemaining', () => {
  it('is empty with no usable expiry', () => {
    expect(formatUndoWindowRemaining(null)).toBe('');
    expect(formatUndoWindowRemaining(EMPTY_DRAW_UNDO_STATUS)).toBe('');
    expect(formatUndoWindowRemaining(status())).toBe('');
    expect(formatUndoWindowRemaining(status({ expiresAt: 'bad' }), NOW)).toBe('');
  });
  it('rounds minutes up and reports expiry', () => {
    expect(formatUndoWindowRemaining(status({ expiresAt: '2026-10-27T12:28:01Z' }), NOW)).toBe('29m left');
    expect(formatUndoWindowRemaining(status({ expiresAt: '2026-10-27T12:00:30Z' }), NOW)).toBe('1m left');
    expect(formatUndoWindowRemaining(status({ expiresAt: '2026-10-27T11:00:00Z' }), NOW)).toBe('Expired');
  });
  it('defaults now to the clock', () => {
    expect(formatUndoWindowRemaining(status({ expiresAt: '2000-01-01T00:00:00Z' }))).toBe('Expired');
  });
});

describe('drawUndoActionLabel', () => {
  it('chooses the label by kind', () => {
    expect(drawUndoActionLabel(null)).toBe('Undo Last Redraw / Restore Deleted Heat');
    expect(drawUndoActionLabel(status({ kind: 'DeleteHeat' }))).toBe('Restore Deleted Heat');
    expect(drawUndoActionLabel(status({ kind: 'ClearHeats' }))).toBe('Restore Deleted Heat');
    for (const kind of ['SectionDraw', 'GenerateHeats', 'GenerateRaceFinals']) {
      expect(drawUndoActionLabel(status({ kind }))).toBe('Undo Last Redraw');
    }
    expect(drawUndoActionLabel(status({ kind: 'Other' }))).toBe('Undo Last Redraw / Restore Deleted Heat');
  });
});

describe('drawUndoBannerDescription', () => {
  it('is empty when nothing is available', () => {
    expect(drawUndoBannerDescription(null)).toBe('');
  });
  it('falls back to a default label and pluralises heats', () => {
    expect(drawUndoBannerDescription(status({ label: '  ', affectedHeats: 1 }), NOW)).toBe('Last draw or heat change (1 heat)');
    expect(drawUndoBannerDescription(status({ label: 'Redraw', affectedHeats: 3 }), NOW)).toBe('Redraw (3 heats)');
  });
  it('adds the time left when known', () => {
    expect(drawUndoBannerDescription(status({ label: 'Redraw', affectedHeats: 2, expiresAt: '2026-10-27T12:05:00Z' }), NOW))
      .toBe('Redraw (2 heats · 5m left)');
  });
  it('defaults now to the clock', () => {
    expect(drawUndoBannerDescription(status({ label: 'R', affectedHeats: 0, expiresAt: '2000-01-01T00:00:00Z' }))).toBe('R (0 heats · Expired)');
  });
});

describe('parseDrawUndoResult', () => {
  it('rejects anything not restored', () => {
    for (const raw of [null, 'x', [], { restored: false }]) expect(parseDrawUndoResult(raw)).toBeNull();
  });
  it('fills defaults for missing fields', () => {
    expect(parseDrawUndoResult({ restored: true })).toEqual({
      restored: true, label: 'Restored previous heat state', restoredSessions: 0, restoredHeats: 0, undoStatus: EMPTY_DRAW_UNDO_STATUS,
    });
  });
  it('keeps provided fields and parses the nested status', () => {
    const r = parseDrawUndoResult({ restored: true, label: 'X', restoredSessions: 2, restoredHeats: 5, undoStatus: { available: true, undoId: 9 } });
    expect(r).toMatchObject({ label: 'X', restoredSessions: 2, restoredHeats: 5 });
    expect(r?.undoStatus.undoId).toBe(9);
  });
});
