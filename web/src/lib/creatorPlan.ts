import { defaultRaceList } from './defaultRaces';
import { heatSizes, planTimetable, type FixedItem, type PlanSession } from './formatPlan';
import {
  heatSizeOf, minutesOf, newSessionName, sectionName, wholeNumber, type BreakDraft, type CreatorDraft, type SectionDraft, type SessionDraft,
} from './creatorDraft';

/** The provisional timetable: an estimate built from the structure and timing chosen in the competition creator. */

export const RIDERS_PER_TEAM: Record<number, number> = { 1: 2, 2: 4, 3: 1 };
/** Used when there is no cap and no teams yet. */
export const GUESSED_TEAMS: Record<number, number> = { 1: 8, 2: 6, 3: 12 };
export const GAP_MINUTES = 10;

export interface TeamEstimate {
  count: number;
  /** teams: real teams exist. cap: worked out from the entry limit. guess: nothing to go on. */
  basis: 'teams' | 'cap' | 'guess';
}

/** How many teams to plan for in a section. */
export function expectedTeams(section: SectionDraft, actualTeams = 0): TeamEstimate {
  if (actualTeams > 0) return { count: actualTeams, basis: 'teams' };
  const cap = wholeNumber(section.maxParticipants);
  if (cap && cap > 0) return { count: Math.max(1, Math.ceil(cap / (RIDERS_PER_TEAM[section.format] ?? 1))), basis: 'cap' };
  return { count: GUESSED_TEAMS[section.format] ?? 6, basis: 'guess' };
}

export const estimateText = (e: TeamEstimate) =>
  e.basis === 'teams' ? `${e.count} teams entered` : e.basis === 'cap' ? `about ${e.count} teams, from the entry limit` : `a guess of ${e.count} teams`;

/** Races in each heat for planning: the chosen list, or the standard one when the races are being left for later. */
export function raceCountFor(section: SectionDraft, session: SessionDraft): number {
  return session.races ? session.races.length : defaultRaceList('Zone', section.format, section.ageGroup).length;
}

export interface PlannedSession {
  /** Position in the plan (also its id for planTimetable). */
  key: number;
  sectionIndex: number;
  sessionIndex: number;
  existingId?: number;
  name: string;
  arena: string;
  races: number;
  racesChosen: boolean;
  teams: TeamEstimate;
  raceFinals: boolean;
  /** It has heats, so it is not estimated: its real times stand. */
  fixed: boolean;
}

/** Every session the draft would have, in running order: section by section. */
export function plannedSessions(draft: CreatorDraft, teamCounts: Readonly<Record<number, number>> = {}): PlannedSession[] {
  const out: PlannedSession[] = [];
  draft.sections.forEach((section, sectionIndex) => {
    const teams = expectedTeams(section, section.existingId ? teamCounts[section.existingId] ?? 0 : 0);
    section.sessions.forEach((session, sessionIndex) => {
      out.push({
        key: out.length, sectionIndex, sessionIndex, existingId: session.existingId,
        name: session.name ?? newSessionName(section, sessionIndex), arena: section.arena.trim() || 'Main arena',
        races: raceCountFor(section, session), racesChosen: session.races !== null, teams, raceFinals: section.usesRaceFinals,
        fixed: !!session.hasHeats,
      });
    });
  });
  return out;
}

export function breakWindow(b: BreakDraft): { start: Date; end: Date } | null {
  const minutes = wholeNumber(b.minutes);
  const start = new Date(`${b.date}T${b.time}`);
  if (!b.date || !b.time || Number.isNaN(start.getTime()) || minutes === null) return null;
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
}

export interface ProvisionalRow {
  kind: 'session' | 'break' | 'briefing';
  name: string;
  arena: string;
  start: Date;
  end: Date;
  minutes: number;
  /** "2 heats of 3" and so on; empty for a break. */
  detail: string;
  /** Index into plannedSessions for a session row. */
  planKey?: number;
  /** Index into the draft's breaks for a break or briefing row. */
  breakKey?: number;
}

export interface Provisional {
  rows: ProvisionalRow[];
  /** When the last thing ends. */
  finishes: Date | null;
  /** The last session ends after the event's end time. */
  overrun: boolean;
}

/** `real` are already-timed sessions with heats (their arena and times) that the estimate must work around. */
export function provisionalTimetable(
  draft: CreatorDraft,
  teamCounts: Readonly<Record<number, number>> = {},
  real: readonly FixedItem[] = [],
): Provisional {
  const plan = plannedSessions(draft, teamCounts);
  const eventStart = new Date(`${draft.startDate}T${draft.startTime || '09:00'}`);
  const breaks = draft.breaks.flatMap((b, index) => { const w = breakWindow(b); return w ? [{ b, index, ...w }] : []; });
  const sessions: PlanSession[] = plan.filter((p) => !p.fixed).map((p) => {
    const section = draft.sections[p.sectionIndex];
    return {
      id: p.key, name: p.name, arena: p.arena, orderIndex: p.key, raceCount: p.races, minutesPerHeat: minutesOf(section),
      lanes: heatSizeOf(section), teamCount: p.teams.count, raceFinals: p.raceFinals,
    };
  });
  const rows = planTimetable({
    eventStart: Number.isNaN(eventStart.getTime()) ? new Date() : eventStart,
    sessions,
    fixed: [...real, ...breaks.map(({ start, end, b }) => ({ start, end, arena: b.arena.trim() }))],
    gapMinutes: GAP_MINUTES,
  });
  const out: ProvisionalRow[] = rows.map((row) => {
    const p = plan[row.id];
    const section = draft.sections[p.sectionIndex];
    return {
      kind: 'session', name: row.name, arena: row.arena, start: row.start, end: row.end, minutes: row.minutes,
      detail: p.raceFinals ? `${p.races} races, each a heat, heat, final` : describeSizes(heatSizes(p.teams.count, heatSizeOf(section)), p.races),
      planKey: row.id,
    };
  });
  for (const { b, index, start, end } of breaks) {
    out.push({ kind: b.kind === 2 ? 'briefing' : 'break', name: b.name.trim() || (b.kind === 2 ? 'Briefing' : 'Break'), arena: b.arena.trim(), start, end, minutes: Math.round((end.getTime() - start.getTime()) / 60_000), detail: '', breakKey: index });
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime() || (a.kind === 'session' ? 1 : 0) - (b.kind === 'session' ? 1 : 0));
  const sessionRows = out.filter((r) => r.kind === 'session' && r.minutes > 0);
  const finishes = sessionRows.length ? new Date(Math.max(...sessionRows.map((r) => r.end.getTime()))) : null;
  const eventEnd = new Date(`${draft.endDate || draft.startDate}T${draft.endTime || '17:00'}`);
  return { rows: out, finishes, overrun: !!finishes && !Number.isNaN(eventEnd.getTime()) && finishes.getTime() > eventEnd.getTime() };
}

function describeSizes(sizes: readonly number[], races: number): string {
  if (sizes.length === 0) return 'no teams';
  const heats = sizes.every((n) => n === sizes[0]) ? `${sizes.length} ${sizes.length === 1 ? 'heat' : 'heats'} of ${sizes[0]}` : `${sizes.length} heats (${sizes.join(', ')})`;
  return `${heats}, ${races} ${races === 1 ? 'race' : 'races'}`;
}

/** What to save on each session without heats: its estimated start and length. */
export function plannedWrites(draft: CreatorDraft, teamCounts: Readonly<Record<number, number>> = {}, real: readonly FixedItem[] = []): Map<number, { start: Date; minutes: number }> {
  const out = new Map<number, { start: Date; minutes: number }>();
  for (const row of provisionalTimetable(draft, teamCounts, real).rows) {
    if (row.kind === 'session' && row.planKey !== undefined) out.set(row.planKey, { start: row.start, minutes: row.minutes });
  }
  return out;
}

/** "Seniors, Juniors" style list of the age groups, for the summary. */
export const sectionNames = (draft: CreatorDraft) => draft.sections.map(sectionName);

/** What one age group works out to, for the structure step: teams, heats and how long a session takes. */
export function sectionEstimate(section: SectionDraft, actualTeams = 0): { teams: TeamEstimate; sizes: number[]; minutesPerSession: number } {
  const teams = expectedTeams(section, actualTeams);
  const sizes = heatSizes(teams.count, heatSizeOf(section));
  const races = section.sessions[0] ? raceCountFor(section, section.sessions[0]) : 0;
  const minutesPerSession = section.usesRaceFinals ? 3 * races * minutesOf(section) : sizes.length * races * minutesOf(section);
  return { teams, sizes, minutesPerSession };
}

/** "1 h 40 min", "45 min". */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
