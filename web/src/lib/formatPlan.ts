/** How the teams of an age group split into heats: as even as possible, no heat bigger than `maxPerHeat`. Matches the server. */
export function heatSizes(teamCount: number, maxPerHeat: number): number[] {
  if (teamCount <= 0) return [];
  const cap = Math.max(1, maxPerHeat);
  const heats = Math.ceil(teamCount / cap);
  const base = Math.floor(teamCount / heats);
  const extra = teamCount % heats;
  return Array.from({ length: heats }, (_, i) => base + (i < extra ? 1 : 0));
}

/** "2 heats of 3", "1 heat of 4", or "3 heats (4, 3, 3)" when they differ. */
export function describeHeats(sizes: readonly number[]): string {
  if (sizes.length === 0) return 'no teams yet';
  const same = sizes.every((size) => size === sizes[0]);
  if (sizes.length === 1) return `1 heat of ${sizes[0]}`;
  return same ? `${sizes.length} heats of ${sizes[0]}` : `${sizes.length} heats (${sizes.join(', ')})`;
}

/** An event that starts at midnight has no time set yet, so the day starts at nine. */
export function defaultEventStart(start: Date): Date {
  if (start.getHours() === 0 && start.getMinutes() === 0) return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 0);
  return new Date(start);
}

export interface PlanSession {
  id: number;
  name: string;
  arena: string;
  orderIndex: number;
  /** Races in each heat. */
  raceCount: number;
  minutesPerHeat: number;
  lanes: number;
  teamCount: number;
  /** Heat, heat, final: every race is two qualifier heats and a final, so three heats of one race each. */
  raceFinals?: boolean;
}

/** A break or briefing that is already on the timetable. An empty arena means everyone stops. */
export interface FixedItem { start: Date; end: Date; arena: string }

export interface PlanRow {
  id: number;
  name: string;
  arena: string;
  sizes: number[];
  start: Date;
  end: Date;
  minutes: number;
}

const arenaKey = (arena: string) => arena.trim().toLowerCase();

/**
 * Works out when each session would start if the timetable were generated now. Each arena runs on its own clock from the
 * start of the event, sessions follow one another in order with a gap between, and a session never overlaps a break or
 * briefing: it starts when that item ends instead. A session with no teams takes no time.
 */
export function planTimetable({ sessions, fixed, eventStart, gapMinutes = 10 }: {
  sessions: readonly PlanSession[];
  fixed: readonly FixedItem[];
  eventStart: Date;
  gapMinutes?: number;
}): PlanRow[] {
  const cursors = new Map<string, number>();
  const stops = [...fixed].sort((a, b) => a.start.getTime() - b.start.getTime());
  const rows: PlanRow[] = [];
  for (const session of [...sessions].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)) {
    const key = arenaKey(session.arena);
    const sizes = heatSizes(session.teamCount, session.lanes);
    const minutes = sizes.length === 0 ? 0
      : session.raceFinals ? 3 * session.minutesPerHeat
        : sizes.length * session.minutesPerHeat;
    let start = cursors.get(key) ?? eventStart.getTime();
    if (minutes > 0) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const stop of stops) {
          if (stop.arena && arenaKey(stop.arena) !== key) continue;
          const end = start + minutes * 60_000;
          if (start < stop.end.getTime() && end > stop.start.getTime()) { start = stop.end.getTime(); moved = true; }
        }
      }
    }
    const end = start + minutes * 60_000;
    rows.push({ id: session.id, name: session.name, arena: session.arena, sizes, start: new Date(start), end: new Date(end), minutes });
    if (minutes > 0) cursors.set(key, end + gapMinutes * 60_000);
  }
  return rows;
}
