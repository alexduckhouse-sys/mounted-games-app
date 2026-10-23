import type { CompetitionDetail } from '../types';

/**
 * Where a competition is in its life, as far as the public is concerned.
 *  - `entry`: entries are being taken. No teams are formed and no timetable is generated yet, so the only useful
 *    thing a visitor can do is enter.
 *  - `running`: teams are formed or a timetable exists (or the event is over). The normal layout applies.
 * Derived from the data, so it needs no stored field. Keep every phase rule here.
 */
export type CompetitionPhase = 'entry' | 'running';

type PhaseInput = Pick<CompetitionDetail, 'sections' | 'teams' | 'sessions' | 'isArchived'>;

export function competitionPhase(competition: PhaseInput): CompetitionPhase {
  if (competition.isArchived) return 'running';
  // Nothing to enter yet, so there is no entry page to show.
  if (competition.sections.length === 0) return 'running';
  if (competition.teams.length > 0) return 'running';
  // Heats are generated with the timetable; a bare break or placeholder session doesn't count. Anything that has
  // started does.
  if (competition.sessions.some((session) => session.heats.length > 0 || session.status !== 0)) return 'running';
  return 'entry';
}

/** True when this viewer should see only the entry page and Details. Organisers always see everything. */
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
