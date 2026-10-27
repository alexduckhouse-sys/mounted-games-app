import type { Heat, Session, VolunteerShift } from '../../types';

/** Where the arena crew sheet for a competition, and optionally one session and heat, lives. */
export function arenaCrewPath(competitionId: number, sessionId?: number | null, heatId?: number | null): string {
  const query = new URLSearchParams();
  if (sessionId != null) query.set('session', String(sessionId));
  if (heatId != null) query.set('heat', String(heatId));
  const text = query.toString();
  return `/competitions/${competitionId}/arena-crew${text ? `?${text}` : ''}`;
}

export const isRaceSession = (s: Session) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0;
export const heatDone = (h: Heat) => h.races.length > 0 && h.races.every((r) => r.isComplete);
export const heatName = (h: Heat) => h.label?.trim() || `Heat ${h.orderIndex}`;

/** The heat that is happening now: the first unfinished one in a live session, else the first unfinished anywhere, else the last. */
export function defaultChoice(sessions: Session[]): { sessionId: number; heatId: number } | null {
  const choices = sessions
    .filter(isRaceSession)
    .slice().sort((a, b) => a.orderIndex - b.orderIndex)
    .flatMap((session) => session.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex).map((heat) => ({ session, heat })));
  const ordered = [...choices.filter((c) => c.session.status === 1), ...choices.filter((c) => c.session.status !== 1)];
  const pick = ordered.find((c) => !heatDone(c.heat)) ?? choices.at(-1);
  return pick ? { sessionId: pick.session.id, heatId: pick.heat.id } : null;
}

/** A duty is a steward or arena crew job tied to a team or a duty type, not an ordinary volunteer slot. */
export function isDutyShift(shift: VolunteerShift, sessionId: number): boolean {
  if (shift.sessionId !== sessionId) return false;
  return (!!shift.dutyCategory && shift.dutyCategory !== 'General') || shift.assignedTeamId != null || !!shift.assignedClubName?.trim();
}
