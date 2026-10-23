import type { ChatMessage, Session } from '../types';
import { displaySectionName } from './section.ts';
import { computeTimings } from './time.ts';
import { sessionOrdinals, sessionTitle, timetableRows, type TimetableRow } from './timetableRows.ts';

/** What a ticker line is about; the top bar gives each kind its own colour and icon. */
export type TickerKind = 'live' | 'next' | 'late' | 'ontime' | 'break' | 'finals' | 'result' | 'announcement' | 'info';

export interface TickerItem {
  /** Stable across refreshes, so the ticker can keep its place as the list changes. */
  key: string;
  kind: TickerKind;
  text: string;
  /** The session this line is about; the ticker links there instead of to the live feed. */
  sessionId?: number;
}

export const MAX_TICKER_ITEMS = 8;
const MINUTE = 60_000;
const LATE_AFTER_MINUTES = 5;
/** Ignore anything this overdue: it was skipped or belongs to another day, not a delay. */
const OVERDUE_LIMIT_MINUTES = 180;
const BREAK_SOON_MINUTES = 30;
const FRESH_ANNOUNCEMENT_MS = 15 * MINUTE;
const ANNOUNCEMENT_MAX_AGE_MS = 8 * 60 * MINUTE;
const MAX_ANNOUNCEMENTS = 3;
const RESULT_MAX_AGE_MS = 30 * MINUTE;
const MAX_LIVE = 2;

const sessionKind = (session: Session) => session.kind ?? (session.isBreak ? 1 : 0);
const isRaceRow = (row: TimetableRow) => sessionKind(row.session) === 0;
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "10:35" today, "Sat 10:35" this week, "14 Jun 10:35" further out. */
export function tickerClock(date: Date, now: Date): string {
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(date, now)) return time;
  const days = Math.abs(date.getTime() - now.getTime()) / (24 * 60 * MINUTE);
  const day = days < 6
    ? date.toLocaleDateString('en-GB', { weekday: 'short' })
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${day} ${time}`;
}

/** "Seniors Session 1 · Heat 2", or "Seniors Finals · Final A" for a final. */
function raceName(row: TimetableRow, ordinals: Map<number, number>) {
  const heat = row.heat ? row.heat.label || `Heat ${row.heatIndex + 1}` : '';
  let title = sessionTitle(row.session, ordinals);
  if (row.group === 'Finals') {
    const group = displaySectionName(row.session.sectionName || row.session.name);
    title = /\bfinals?\b/i.test(group) ? group : `${group} Finals`;
  }
  return heat ? `${title} · ${heat}` : title;
}

/** "Lunch break", "Riders briefing"; custom items keep their own name. */
function breakName(session: Session) {
  const kind = sessionKind(session);
  const label = kind === 2 ? 'briefing' : kind === 1 ? 'break' : '';
  const name = oneLine(session.name);
  if (!name) return label ? label[0].toUpperCase() + label.slice(1) : 'Break';
  return label && !new RegExp(`\\b${label}`, 'i').test(name) ? `${name} ${label}` : name;
}

function breakEnd(row: TimetableRow): Date | null {
  const minutes = row.session.durationMinutes ?? 0;
  return row.effective && minutes > 0 ? new Date(row.effective.getTime() + minutes * MINUTE) : null;
}

function latestResult(sessions: Session[], now: number): TickerItem | null {
  let best: { at: number; id: number; text: string; sessionId: number } | null = null;
  for (const session of sessions) {
    for (const heat of session.heats) {
      for (const race of heat.races) {
        if (!race.isComplete || !race.finishedAt) continue;
        const at = new Date(race.finishedAt).getTime();
        if (!Number.isFinite(at) || now - at > RESULT_MAX_AGE_MS || at - now > MINUTE) continue;
        const winners = race.results.filter((result) => result.placing === 1 && !result.eliminated).map((result) => result.teamName);
        if (winners.length === 0 || (best && best.at >= at)) continue;
        best = { at, id: race.id, text: `${winners.join(' & ')} won ${oneLine(race.name) || 'a race'}`, sessionId: session.id };
      }
    }
  }
  return best ? { key: `result-${best.id}`, kind: 'result', text: best.text, sessionId: best.sessionId } : null;
}

/**
 * Lines for the top-bar ticker, most important first:
 * fresh announcements, what is on now, running late or on time, what is next,
 * a break coming up, the latest winner, then older announcements. Capped at
 * {@link MAX_TICKER_ITEMS}; falls back to the competition name when there is nothing to say.
 */
export function tickerItems(sessions: Session[], announcements: ChatMessage[], now: Date, fallback?: string): TickerItem[] {
  const t = now.getTime();
  const rows = timetableRows(sessions, computeTimings(sessions), true);
  const ordinals = sessionOrdinals(sessions);

  const liveRaces = rows.filter((row) => row.status === 'live' && isRaceRow(row));
  const firstLive = liveRaces.length > 0 ? rows.indexOf(liveRaces[0]) : -1;
  const upcoming = rows.filter((row, index) => row.effective && row.status !== 'finished' && row.status !== 'live' && (firstLive >= 0
    ? index > firstLive
    : row.effective.getTime() >= t - OVERDUE_LIMIT_MINUTES * MINUTE));
  const nextRace = upcoming.find(isRaceRow);

  // A break or briefing that has been started, or whose time slot we are in while nothing is racing.
  const breakNow = rows.find((row) => !isRaceRow(row) && row.status === 'live')
    ?? (liveRaces.length === 0 ? upcoming.find((row) => {
      const end = breakEnd(row);
      return !isRaceRow(row) && row.effective && end && row.effective.getTime() <= t && t < end.getTime();
    }) : undefined);
  const breakSoon = upcoming.find((row) => !isRaceRow(row) && row !== breakNow && row.effective
    && (row === upcoming[0] || row.effective.getTime() - t <= BREAK_SOON_MINUTES * MINUTE));

  const recent = announcements
    .filter((message) => message.type === 2 && t - new Date(message.createdAt).getTime() < ANNOUNCEMENT_MAX_AGE_MS)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_ANNOUNCEMENTS)
    .map((message) => ({ message, fresh: t - new Date(message.createdAt).getTime() < FRESH_ANNOUNCEMENT_MS }));
  const announcement = ({ message }: { message: ChatMessage }): TickerItem => ({ key: `announcement-${message.id}`, kind: 'announcement', text: oneLine(message.body) });

  const items: TickerItem[] = [];
  items.push(...recent.filter((item) => item.fresh).map(announcement));

  for (const row of liveRaces.slice(0, MAX_LIVE)) {
    items.push({ key: `live-${row.key}`, kind: row.group === 'Finals' ? 'finals' : 'live', text: `Now: ${raceName(row, ordinals)}`, sessionId: row.session.id });
  }
  if (breakNow) {
    const end = breakEnd(breakNow);
    items.push({ key: `break-${breakNow.key}`, kind: 'break', text: end ? `${breakName(breakNow.session)} until ${tickerClock(end, now)}` : `${breakName(breakNow.session)} now`, sessionId: breakNow.session.id });
  }

  if (liveRaces.length > 0 || upcoming.length > 0) {
    let behind = Math.max(0, ...rows.filter((row) => row.status !== 'finished').map((row) => row.delayMinutes));
    const overdue = nextRace?.effective ? Math.round((t - nextRace.effective.getTime()) / MINUTE) : 0;
    if (overdue <= OVERDUE_LIMIT_MINUTES) behind = Math.max(behind, overdue);
    if (behind >= LATE_AFTER_MINUTES) items.push({ key: 'late', kind: 'late', text: `Running ${behind} min behind` });
    else if (liveRaces.length > 0) items.push({ key: 'ontime', kind: 'ontime', text: 'On time' });
  }

  if (nextRace?.effective) {
    items.push({ key: `next-${nextRace.key}`, kind: nextRace.group === 'Finals' ? 'finals' : 'next', text: `Next ${tickerClock(nextRace.effective, now)}: ${raceName(nextRace, ordinals)}`, sessionId: nextRace.session.id });
  }
  if (breakSoon?.effective) {
    items.push({ key: `break-${breakSoon.key}`, kind: 'break', text: `${breakName(breakSoon.session)} ${tickerClock(breakSoon.effective, now)}`, sessionId: breakSoon.session.id });
  }

  const races = rows.filter(isRaceRow);
  if (races.length > 0 && races.every((row) => row.status === 'finished')) {
    items.push({ key: 'finished', kind: 'info', text: 'Racing finished' });
  }

  const result = latestResult(sessions, t);
  if (result) items.push(result);
  items.push(...recent.filter((item) => !item.fresh).map(announcement));

  if (items.length === 0 && fallback?.trim()) items.push({ key: 'info', kind: 'info', text: oneLine(fallback) });
  return items.slice(0, MAX_TICKER_ITEMS);
}

/** True when both lists would show the same lines, so the ticker need not re-render. */
export function sameTickerItems(a: TickerItem[], b: TickerItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item.key === b[index].key && item.kind === b[index].kind && item.text === b[index].text && item.sessionId === b[index].sessionId);
}

/**
 * Which line to show after the list changes: jump to the newest announcement that was
 * not in the previous list, otherwise stay on the same line (or the first one).
 */
export function tickerFocusAfterChange(previous: TickerItem[], next: TickerItem[], activeKey: string | null): string | null {
  if (previous.length > 0) {
    const seen = new Set(previous.map((item) => item.key));
    const arrived = next.find((item) => item.kind === 'announcement' && !seen.has(item.key));
    if (arrived) return arrived.key;
  }
  return next.some((item) => item.key === activeKey) ? activeKey : next[0]?.key ?? null;
}
