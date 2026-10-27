import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { getSectionProvisionalState, getSessionProvisionalState } from './provisionalResults';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 10,
    competitionId: 1,
    competitionSectionId: 2,
    sectionName: 'U15 Teams',
    name: 'U15 Session 1',
    status: 2,
    orderIndex: 1,
    isBreak: false,
    kind: 0,
    finishedAt: '2026-07-10T12:00:00Z',
    provisionalUntil: '2026-07-10T12:15:00Z',
    officialConfirmedAt: null,
    heats: [
      {
        id: 100,
        sessionId: 10,
        orderIndex: 1,
        entries: [],
        races: [
          {
            id: 1000,
            heatId: 100,
            name: 'Bending',
            orderIndex: 1,
            isComplete: true,
            results: [
              { id: 1, teamId: 5, teamName: 'Kent A', placing: 1, eliminated: false, points: 5, underReview: false },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('provisionalResults (#3)', () => {
  it('reports remaining minutes during the 15-minute provisional query window', () => {
    const session = makeSession();
    const nowMs = Date.parse('2026-07-10T12:06:10Z');
    const state = getSessionProvisionalState(session, nowMs);

    expect(state.status).toBe('provisional');
    expect(state.isProvisional).toBe(true);
    expect(state.isOfficial).toBe(false);
    expect(state.remainingMinutes).toBe(9);
    expect(state.badgeText).toBe('Provisional · 9m left for queries');
  });

  it('transitions automatically to official once provisionalUntil passes with no under-review flags', () => {
    const session = makeSession();
    const nowMs = Date.parse('2026-07-10T12:15:01Z');
    const state = getSessionProvisionalState(session, nowMs);

    expect(state.status).toBe('official');
    expect(state.isOfficial).toBe(true);
    expect(state.isProvisional).toBe(false);
    expect(state.badgeText).toBe('Official');
  });

  it('holds the session in under-review-hold even after 15 minutes if any result is flagged under review', () => {
    const session = makeSession({
      heats: [
        {
          id: 100,
          sessionId: 10,
          orderIndex: 1,
          entries: [],
          races: [
            {
              id: 1000,
              heatId: 100,
              name: 'Bending',
              orderIndex: 1,
              isComplete: true,
              results: [
                { id: 1, teamId: 5, teamName: 'Kent A', placing: 1, eliminated: false, points: 5, underReview: true },
              ],
            },
          ],
        },
      ],
    });
    const nowMs = Date.parse('2026-07-10T12:45:00Z');
    const state = getSessionProvisionalState(session, nowMs);

    expect(state.status).toBe('under-review-hold');
    expect(state.isProvisional).toBe(true);
    expect(state.isOfficial).toBe(false);
    expect(state.hasUnderReview).toBe(true);
    expect(state.badgeText).toBe('Provisional · Result under review');
  });

  it('immediately marks the session official when staff confirm it early', () => {
    const session = makeSession({
      provisionalUntil: '2026-07-10T12:04:00Z',
      officialConfirmedAt: '2026-07-10T12:04:00Z',
    });
    const nowMs = Date.parse('2026-07-10T12:04:05Z');
    const state = getSessionProvisionalState(session, nowMs);

    expect(state.status).toBe('official');
    expect(state.isOfficial).toBe(true);
    expect(state.badgeText).toBe('Official');
  });

  it('summarises section provisional state across finished sessions', () => {
    const s1 = makeSession({ id: 1, provisionalUntil: '2026-07-10T11:00:00Z' });
    const s2 = makeSession({ id: 2, provisionalUntil: '2026-07-10T12:15:00Z' });
    const nowMs = Date.parse('2026-07-10T12:10:00Z');
    const sectionState = getSectionProvisionalState([s1, s2], 2, nowMs);

    expect(sectionState?.status).toBe('provisional');
    expect(sectionState?.remainingMinutes).toBe(5);
  });
});
