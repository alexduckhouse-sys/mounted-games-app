import type { ChatMessage, Session } from '../types';
import { computeTimings } from './time.ts';
import { sessionOrdinals, sessionTitle, timetableRows } from './timetableRows.ts';

const LATE_AFTER_MINUTES = 5;
const ANNOUNCEMENT_MAX_AGE_MS = 8 * 60 * 60_000;
const MAX_ANNOUNCEMENTS = 3;

/** Short lines for the top-bar ticker: what is on now, how late things are, then recent announcements. */
export function tickerItems(sessions: Session[], announcements: ChatMessage[], now: Date): string[] {
  const items: string[] = [];
  const rows = timetableRows(sessions, computeTimings(sessions), true);
  const ordinals = sessionOrdinals(sessions);
  const live = rows.find((row) => row.status === 'live' && row.session.kind === 0);
  if (live) {
    const heat = live.heat ? live.heat.label || `Heat ${live.heatIndex + 1}` : '';
    items.push(`Now: ${sessionTitle(live.session, ordinals)}${heat ? ` · ${heat}` : ''}`);
  }
  const behind = Math.max(0, ...rows.filter((row) => row.status !== 'finished').map((row) => row.delayMinutes));
  if (behind >= LATE_AFTER_MINUTES) items.push(`Running ${behind} min behind`);
  announcements
    .filter((message) => message.type === 2 && now.getTime() - new Date(message.createdAt).getTime() < ANNOUNCEMENT_MAX_AGE_MS)
    .slice(-MAX_ANNOUNCEMENTS)
    .reverse()
    .forEach((message) => items.push(`📣 ${message.body.replace(/\s+/g, ' ').trim()}`));
  return items;
}
