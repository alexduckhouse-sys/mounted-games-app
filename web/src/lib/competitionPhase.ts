import type { CompetitionDetail, Heat, Session } from '../types';

/**
 * Where a competition is in its life, as far as the public is concerned.
 *  - `entry`: entries are being taken. No timetable/heats are generated yet, so the default home view is the entry page.
 *  - `running`: a timetable/heats exist and racing is upcoming or in progress.
 *  - `complete`: finals have finished.
 * Derived from the data, so it needs no stored field. Keep every phase rule here.
 */
export type CompetitionPhase = 'entry' | 'running' | 'complete';

type PhaseInput = Pick<CompetitionDetail, 'sections' | 'teams' | 'sessions' | 'isArchived'> & {
  startDate?: string | null;
  endDate?: string | null;
};

const isRace = (s: Session) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0;
const isFinalHeat = (s: Session, h: Heat) => (h.raceRoundStage === 2 && !h.raceRoundId) || /\bfinals?\b/i.test(h.label ?? '') || /\bfinals?\b/i.test(s.name);
const isHeatComplete = (s: Session, h: Heat) => s.status === 2 || !!h.finishedAt || (h.races.length > 0 && h.races.every((r) => r.isComplete));

export function competitionPhase(competition: PhaseInput): CompetitionPhase {
  const raceSessions = competition.sessions.filter(isRace);
  const finalHeats = raceSessions.flatMap((s) => (s.heats ?? []).filter((h) => isFinalHeat(s, h)).map((h) => ({ s, h })));
  const heatedSessions = raceSessions.filter((s) => (s.heats?.length ?? 0) > 0);
  const hasUndrawnRaceSessions = raceSessions.some((s) => (s.heats?.length ?? 0) === 0 && s.status !== 2);
  const startDay = competition.startDate?.slice(0, 10) ?? '';
  const endDay = competition.endDate?.slice(0, 10) ?? '';
  const isMultiDay = Boolean(startDay && endDay && endDay > startDay);
  const hasScheduledSessions = raceSessions.some((s) => Boolean(s.scheduledStart));
  const hasFinalDaySession = !isMultiDay || !hasScheduledSessions || raceSessions.some((s) => (s.scheduledStart?.slice(0, 10) ?? '') >= endDay);
  if (
    finalHeats.length > 0
    && !hasUndrawnRaceSessions
    && hasFinalDaySession
    && finalHeats.every(({ s, h }) => isHeatComplete(s, h))
    && heatedSessions.every((s) => s.status === 2 || s.heats.every((h) => isHeatComplete(s, h)))
  ) {
    return 'complete';
  }
  if (competition.isArchived) return 'running';
  // Nothing to enter yet, so there is no entry page to show.
  if (competition.sections.length === 0) return 'running';
  // Heats are generated with the timetable; a bare break or placeholder session doesn't count. Anything that has
  // started does. Forming teams alone does NOT exit the entry phase.
  if (competition.sessions.some((session) => (session.heats?.length ?? 0) > 0 || session.status !== 0)) return 'running';
  return 'entry';
}

/** True when this viewer should see the entry page as the home landing page. Organisers always see the timetable. */
export function entryPhaseOnly(competition: PhaseInput, canOrganise: boolean): boolean {
  return !canOrganise && competitionPhase(competition) === 'entry';
}

/** "Free", "£15.00" or "From £10.00", from the sections' prices. */
export function entryFeeText(sections: CompetitionDetail['sections']): string | null {
  if (sections.length === 0) return null;
  const prices = sections.map((s) => s.priceMinor ?? 0);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;
  if (high === 0) return 'Free';
  return low === high ? money(low) : `From ${low === 0 ? 'free' : money(low)} to ${money(high)}`;
}
