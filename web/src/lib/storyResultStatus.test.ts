import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { storyResultsAreProvisional } from './storyResultStatus';

const now = Date.parse('2026-01-01T12:00:00Z');
const session = (patch: Partial<Session> = {}): Session => ({
  id: 1, competitionSectionId: 1, kind: 0, status: 2, isBreak: false,
  finishedAt: '2026-01-01T11:00:00Z', heats: [], ...patch,
} as Session);

describe('story result status', () => {
  it('keeps empty, undrawn and live sections provisional', () => {
    expect(storyResultsAreProvisional([], 1, now)).toBe(true);
    for (const status of [0, 1] as const) {
      expect(storyResultsAreProvisional([session({ status })], 1, now)).toBe(true);
    }
  });
  it('does not call later unfinished sessions official after an earlier result is official', () => {
    expect(storyResultsAreProvisional([session(), session({ id: 2, status: 1 })], 1, now)).toBe(true);
    expect(storyResultsAreProvisional([session(), session({ id: 2, status: 0 })], 1, now)).toBe(true);
  });
  it('keeps a finished section provisional during queries or a review hold', () => {
    expect(storyResultsAreProvisional([session({ provisionalUntil: '2026-01-01T12:05:00Z' })], 1, now)).toBe(true);
    const heats = [{ races: [{ results: [{ underReview: true }] }] }] as Session['heats'];
    expect(storyResultsAreProvisional([session({ heats })], 1, now)).toBe(true);
  });
  it('is official only when all relevant sessions are official', () => {
    expect(storyResultsAreProvisional([session(), session({ id: 2 })], 1, now)).toBe(false);
  });
  it('ignores other sections and breaks, while accepting legacy race sessions with no kind', () => {
    expect(storyResultsAreProvisional([
      session({ kind: undefined }), session({ id: 2, competitionSectionId: 2, status: 1 }),
      session({ id: 3, isBreak: true, kind: 1, status: 0 }),
    ], 1, now)).toBe(false);
    expect(storyResultsAreProvisional([session({ kind: undefined, status: 1 })], 1, now)).toBe(true);
  });
});
