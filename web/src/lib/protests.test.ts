import { describe, expect, it, vi } from 'vitest';
import { ProtestStatus, type Protest } from '../types';
import {
  PROTESTS_CHANGED_EVENT, PROTEST_STATUS_LABELS, announceProtestsChanged, decisionProblem, protestRequestId,
  protestTone, protestWhere, protestsBlocking, underReviewNames,
} from './protests';

function protest(overrides: Partial<Protest> = {}): Protest {
  return {
    id: 1, competitionId: 1, sessionId: 1, sessionName: 'Session A', heatId: 10, heatLabel: 'Heat 1', heatOrder: 1,
    raceId: 100, raceName: 'Bending', concerns: [], reason: 'Crossed lanes', status: ProtestStatus.Open,
    createdAt: '2026-10-27T10:00:00Z', raceSignedOff: false, ...overrides,
  };
}

describe('protest helpers', () => {
  it('names every status', () => {
    expect(Object.values(PROTEST_STATUS_LABELS)).toEqual(['Open', 'Upheld', 'Dismissed', 'Withdrawn']);
  });

  it('gives open protests a warning tone, decided ones good and withdrawn ones grey', () => {
    expect(protestTone(ProtestStatus.Open)).toBe('warn');
    expect(protestTone(ProtestStatus.Upheld)).toBe('good');
    expect(protestTone(ProtestStatus.Dismissed)).toBe('good');
    expect(protestTone(ProtestStatus.Withdrawn)).toBe('grey');
  });

  it('says where a protest is, falling back when names are missing', () => {
    expect(protestWhere(protest())).toBe('Bending · Heat 1');
    expect(protestWhere(protest({ raceId: null, raceName: null }))).toBe('Whole heat · Heat 1');
    expect(protestWhere(protest({ heatLabel: '  ', heatOrder: 3, raceName: '' }))).toBe('Race · Heat 3');
    expect(protestWhere(protest({ heatLabel: null, heatOrder: 2 }))).toBe('Bending · Heat 2');
  });

  it('finds the open protests that block a race: its own and its heat-wide ones', () => {
    const own = protest({ id: 1 });
    const heatWide = protest({ id: 2, raceId: null });
    const otherRace = protest({ id: 3, raceId: 101 });
    const otherHeat = protest({ id: 4, heatId: 11, raceId: null });
    const decided = protest({ id: 5, status: ProtestStatus.Dismissed });
    expect(protestsBlocking([own, heatWide, otherRace, otherHeat, decided], 100, 10).map((p) => p.id)).toEqual([1, 2]);
  });

  it('needs a decision text to uphold or dismiss, but not to withdraw', () => {
    expect(decisionProblem(ProtestStatus.Open, 'x')).toBe('Choose an outcome.');
    expect(decisionProblem(ProtestStatus.Upheld, '  ')).toBe('Write down the decision and the reason for it.');
    expect(decisionProblem(ProtestStatus.Dismissed, 'No evidence')).toBeNull();
    expect(decisionProblem(ProtestStatus.Withdrawn, '')).toBeNull();
  });

  it('lists the names of races under review', () => {
    expect(underReviewNames([{ label: 'Bending', underReview: true }, { label: 'Flag', underReview: false }, { label: 'Mug', underReview: true }]))
      .toEqual(['Bending', 'Mug']);
  });

  it('makes request ids from the random source, or from crypto by default', () => {
    expect(protestRequestId(() => 'abc')).toBe('protest-abc');
    expect(protestRequestId()).toMatch(/^protest-.+/);
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    try {
      expect(protestRequestId()).toMatch(/^protest-\d+-[0-9a-f]*$/);
    } finally {
      vi.stubGlobal('crypto', original);
    }
  });

  it('announces changes on the window', () => {
    const heard = vi.fn();
    window.addEventListener(PROTESTS_CHANGED_EVENT, heard);
    announceProtestsChanged();
    window.removeEventListener(PROTESTS_CHANGED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
