import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import {
  DEFAULT_PROVISIONAL_MINUTES, getSectionProvisionalState, getSessionProvisionalState, sessionHasUnderReviewResult,
} from './provisionalResults';

const NOW = Date.parse('2026-07-10T12:00:00Z');

function session(over: Partial<Session> = {}): Session {
  return {
    id: 1, competitionId: 1, competitionSectionId: 2, sectionName: 'S', name: 'N', status: 2, orderIndex: 1,
    isBreak: false, kind: 0, finishedAt: '2026-07-10T11:55:00Z', provisionalUntil: null, officialConfirmedAt: null, heats: [],
    ...over,
  } as Session;
}

const reviewHeats = (underReview: boolean): Session['heats'] => [{
  id: 1, sessionId: 1, orderIndex: 1, entries: [],
  races: [{ id: 1, heatId: 1, name: 'R', orderIndex: 1, isComplete: true,
    results: [{ id: 1, teamId: 1, teamName: 'A', placing: 1, eliminated: false, points: 1, underReview }] }],
}];

describe('sessionHasUnderReviewResult', () => {
  it('is false without results and true when one is flagged', () => {
    expect(sessionHasUnderReviewResult(session())).toBe(false);
    expect(sessionHasUnderReviewResult(session({ heats: reviewHeats(false) }))).toBe(false);
    expect(sessionHasUnderReviewResult(session({ heats: reviewHeats(true) }))).toBe(true);
  });
});

describe('getSessionProvisionalState', () => {
  it('is in-progress before the session finishes, with a badge only when a result is under review', () => {
    const plain = getSessionProvisionalState(session({ status: 1 }), NOW);
    expect(plain).toMatchObject({ status: 'in-progress', badgeText: null, provisionalUntilIso: null, officialConfirmedAtIso: null });
    const flagged = getSessionProvisionalState(
      session({ status: 1, heats: reviewHeats(true), provisionalUntil: 'u', officialConfirmedAt: 'c' }), NOW);
    expect(flagged).toMatchObject({ status: 'in-progress', hasUnderReview: true, badgeText: 'Result under review', provisionalUntilIso: 'u', officialConfirmedAtIso: 'c' });
  });

  it('defaults the window to 15 minutes after the finish when no explicit deadline is set', () => {
    expect(DEFAULT_PROVISIONAL_MINUTES).toBe(15);
    const s = getSessionProvisionalState(session(), NOW);
    expect(s).toMatchObject({ status: 'provisional', isProvisional: true, remainingSeconds: 600, remainingMinutes: 10, badgeText: 'Provisional · 10m left for queries' });
  });

  it('treats a timestamp without a zone as UTC and an explicit offset as given', () => {
    const naive = getSessionProvisionalState(session({ provisionalUntil: '2026-07-10T12:05:00' }), NOW);
    expect(naive.remainingSeconds).toBe(300);
    const offset = getSessionProvisionalState(session({ provisionalUntil: '2026-07-10T13:05:00+01:00' }), NOW);
    expect(offset.remainingSeconds).toBe(300);
    const compact = getSessionProvisionalState(session({ provisionalUntil: '2026-07-10T13:05:00+0100' }), NOW);
    expect(compact.remainingSeconds).toBe(300);
  });

  it('rounds a sub-minute remainder up to one minute', () => {
    const s = getSessionProvisionalState(session({ provisionalUntil: '2026-07-10T12:00:10Z' }), NOW);
    expect(s).toMatchObject({ remainingSeconds: 10, remainingMinutes: 1 });
  });

  it('is official when there is no finish time, no deadline and nothing to count down', () => {
    const s = getSessionProvisionalState(session({ finishedAt: null }), NOW);
    expect(s).toMatchObject({ status: 'official', isOfficial: true, remainingSeconds: 0, badgeText: 'Official' });
    const garbage = getSessionProvisionalState(session({ finishedAt: 'not a date', provisionalUntil: 'nope' }), NOW);
    expect(garbage.status).toBe('official');
  });

  it('is official once the deadline has passed', () => {
    const s = getSessionProvisionalState(session({ provisionalUntil: '2026-07-10T11:50:00Z', officialConfirmedAt: null }), NOW);
    expect(s).toMatchObject({ status: 'official', provisionalUntilIso: '2026-07-10T11:50:00Z', officialConfirmedAtIso: null });
  });

  it('holds provisional while under review, reporting the time left', () => {
    const s = getSessionProvisionalState(session({ heats: reviewHeats(true), provisionalUntil: '2026-07-10T12:10:00Z', officialConfirmedAt: '2026-07-10T11:56:00Z' }), NOW);
    expect(s).toMatchObject({ status: 'under-review-hold', isProvisional: true, isOfficial: false, remainingMinutes: 10, badgeText: 'Provisional · Result under review', officialConfirmedAtIso: '2026-07-10T11:56:00Z' });
    const noDeadline = getSessionProvisionalState(session({ heats: reviewHeats(true), finishedAt: null }), NOW);
    expect(noDeadline).toMatchObject({ status: 'under-review-hold', remainingSeconds: 0, provisionalUntilIso: null });
  });

  it('honours an early organiser confirmation', () => {
    const early = getSessionProvisionalState(session({ provisionalUntil: '2026-07-10T12:10:00Z', officialConfirmedAt: '2026-07-10T12:12:00Z' }), NOW);
    expect(early.status).toBe('official');
    const confirmedWithoutDeadline = getSessionProvisionalState(session({ officialConfirmedAt: '2026-07-10T11:58:00Z' }), NOW);
    expect(confirmedWithoutDeadline).toMatchObject({ status: 'official', officialConfirmedAtIso: '2026-07-10T11:58:00Z', provisionalUntilIso: null });
  });

  it('keeps counting down when a confirmation predates a live deadline', () => {
    const s = getSessionProvisionalState(session({ provisionalUntil: '2026-07-10T12:10:00Z', officialConfirmedAt: '2026-07-10T11:56:00Z' }), NOW);
    expect(s.status).toBe('provisional');
  });

  it('uses the clock when now is omitted', () => {
    const s = getSessionProvisionalState(session({ provisionalUntil: '2000-01-01T00:00:00Z' }));
    expect(s.status).toBe('official');
  });
});

describe('getSectionProvisionalState', () => {
  it('is null with no finished race sessions', () => {
    expect(getSectionProvisionalState([], null, NOW)).toBeNull();
    expect(getSectionProvisionalState([session({ isBreak: true }), session({ kind: 1 as never }), session({ status: 1 })], undefined, NOW)).toBeNull();
    expect(getSectionProvisionalState([session({ competitionSectionId: 9 })], 2, NOW)).toBeNull();
  });

  it('filters by section only when one is given', () => {
    const a = session({ id: 1, competitionSectionId: 2 });
    const b = session({ id: 2, competitionSectionId: 3, finishedAt: '2026-07-10T11:59:00Z' });
    expect(getSectionProvisionalState([a, b], 3, NOW)?.remainingSeconds).toBe(840);
    expect(getSectionProvisionalState([a, b], null, NOW)?.remainingSeconds).toBe(840);
  });

  it('prefers an under-review hold over everything', () => {
    const held = session({ id: 1, heats: reviewHeats(true) });
    const fresh = session({ id: 2, finishedAt: '2026-07-10T12:00:00Z' });
    expect(getSectionProvisionalState([fresh, held], 2, NOW)?.status).toBe('under-review-hold');
  });

  it('otherwise returns the provisional state with most time left', () => {
    const soon = session({ id: 1, finishedAt: '2026-07-10T11:50:00Z' });
    const later = session({ id: 2, finishedAt: '2026-07-10T11:59:00Z' });
    expect(getSectionProvisionalState([soon, later], 2, NOW)?.remainingSeconds).toBe(840);
  });

  it('falls back to the last state when all are official', () => {
    const old = session({ id: 1, finishedAt: '2026-07-10T09:00:00Z' });
    const older = session({ id: 2, finishedAt: '2026-07-10T08:00:00Z', officialConfirmedAt: '2026-07-10T08:10:00Z' });
    const s = getSectionProvisionalState([old, older], 2, NOW);
    expect(s?.status).toBe('official');
    expect(s?.officialConfirmedAtIso).toBe('2026-07-10T08:10:00Z');
  });

  it('uses the clock when now is omitted', () => {
    expect(getSectionProvisionalState([session({ provisionalUntil: '2000-01-01T00:00:00Z' })])?.status).toBe('official');
  });
});
