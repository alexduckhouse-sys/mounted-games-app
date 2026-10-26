import type { Heat, Session } from '../types';

/** A heat with the session (and so the arena) it belongs to. */
export interface HeatRef { session: Session; heat: Heat; index: number }

/** The arena a session runs in. Events with one arena rarely name it. */
export function arenaOf(session: Session): string {
  return session.arenaName?.trim() || 'Main Arena';
}

/** The heat's own label, else "Heat 1", "Heat 2"... by its place in its session. */
export function heatName(heat: Heat, index: number): string {
  return heat.label?.trim() || `Heat ${index + 1}`;
}

/** The part of a session's name that says who is racing: its age group, else the session name. */
export function groupOf(session: Session): string {
  return session.sectionName?.trim() || session.name;
}

/** Every heat of every race session, in the order the day runs them. */
export function allHeats(sessions: readonly Session[]): HeatRef[] {
  return sessions
    .filter((s) => (s.kind ?? (s.isBreak ? 1 : 0)) === 0)
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .flatMap((session) => session.heats
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((heat, index) => ({ session, heat, index })));
}

export const heatIsComplete = (heat: Heat): boolean => heat.races.length > 0 && heat.races.every((r) => r.isComplete);

const heatHasStarted = (heat: Heat): boolean => Boolean(heat.startedAt) || heat.races.some((r) => r.isComplete);

/** The first heat in an arena that still has racing to score. A heat with no teams yet only counts when nothing else is left. */
export function currentHeatIn(refs: readonly HeatRef[], arena: string): HeatRef | null {
  const open = refs.filter((r) => arenaOf(r.session) === arena && !heatIsComplete(r.heat));
  return open.find((r) => r.heat.entries.length > 0) ?? open[0] ?? null;
}

/**
 * Whether a scorer on `arena` can score this heat straight away: it is in their arena and is the current heat or an
 * earlier one (so finished heats can still be corrected). Anything else opens as a read-only table first.
 */
export function canScoreHeat(refs: readonly HeatRef[], arena: string, target: HeatRef): boolean {
  if (arenaOf(target.session) !== arena) return false;
  if (heatHasStarted(target.heat)) return true;
  return currentHeatIn(refs, arena)?.heat.id === target.heat.id;
}

function clock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** One line on the state of a heat for the picker: finished, which race it is on, or when it starts. */
export function heatStatus(ref: HeatRef): string {
  const { heat, session } = ref;
  const total = heat.races.length;
  const done = heat.races.filter((r) => r.isComplete).length;
  if (total > 0 && done === total) return 'Finished';
  if (done > 0 || heat.startedAt) return `Scoring · race ${Math.min(done + 1, total)} of ${total}`;
  const at = clock(heat.scheduledStart ?? session.scheduledStart);
  return at ? `Not started · ${at}` : 'Not started';
}

/** "Under 12 · Heat 1": what the bar shows after the arena. */
export function heatBarLabel(ref: HeatRef): string {
  return `${groupOf(ref.session)} · ${heatName(ref.heat, ref.index)}`;
}
