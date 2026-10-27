import type { Session } from '../types';
import { getSessionProvisionalState } from './provisionalResults';

/** Shared cards are only official once every race session in the section is finished and official. */
export function storyResultsAreProvisional(sessions: readonly Session[], sectionId?: number | null, nowMs = Date.now()): boolean {
  const relevant = sessions.filter((session) =>
    !session.isBreak && (session.kind ?? 0) === 0 &&
    (sectionId == null || session.competitionSectionId === sectionId));
  return relevant.length === 0 || relevant.some((session) =>
    session.status !== 2 || !getSessionProvisionalState(session, nowMs).isOfficial);
}
