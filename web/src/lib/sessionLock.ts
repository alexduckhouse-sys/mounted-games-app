import type { Session } from '../types';

/**
 * A session whose times are a record: it has started, or any of its heats has started or finished, or any race is
 * scored. Its start, order and length can't be changed on Timetable and draw ("Move everything" still moves what is
 * left). A session that is only drawn (heats and lanes, nothing run yet) is not locked: heats keep their lanes and
 * their times follow the session.
 */
export function isSessionLocked(session: Session): boolean {
  if (session.status !== 0 || session.startedAt) return true;
  return session.heats.some((heat) => Boolean(heat.startedAt || heat.finishedAt) || heat.races.some((race) => race.isComplete));
}
