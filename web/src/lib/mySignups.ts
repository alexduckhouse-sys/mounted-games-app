import type { MySignup } from '../types';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Whether an entry's event is still to come. The list only knows the start date, so an event that began yesterday
 * still counts (a second day), and an unreadable date counts too rather than hiding the entry.
 */
export function isComingUp(startDate: string, now: Date): boolean {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return true;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return start.getTime() >= startOfToday - DAY;
}

/** Entries split into coming up (soonest first) and past (latest first). */
export function groupSignups(signups: readonly MySignup[], now: Date): { comingUp: MySignup[]; past: MySignup[] } {
  const time = (s: MySignup) => new Date(s.competitionStart).getTime() || 0;
  const comingUp = signups.filter((s) => isComingUp(s.competitionStart, now)).sort((a, b) => time(a) - time(b));
  const past = signups.filter((s) => !isComingUp(s.competitionStart, now)).sort((a, b) => time(b) - time(a));
  return { comingUp, past };
}
