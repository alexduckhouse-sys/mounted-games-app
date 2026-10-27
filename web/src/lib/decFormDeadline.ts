import { activeLocale, tr } from '../i18n/translate';

/** What `GET /declaration-forms/competition/{id}/lock-time` says: when dec forms close, and whether they already have. */
export interface LockInfo {
  competitionId?: number;
  declarationsCloseAt: string | null;
  isClosed: boolean;
}

/** "Fri 23 Oct, 18:00": the day and time a dec form deadline falls, in the device's zone. */
export function lockMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString(activeLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time}`;
}

/** True once the deadline has passed, or an organiser has closed dec forms. No deadline set means open. */
export function isLocked(info: LockInfo | null | undefined, now: number = Date.now()): boolean {
  if (!info?.declarationsCloseAt) return false;
  return info.isClosed || now >= new Date(info.declarationsCloseAt).getTime();
}

/** The line next to a competition's name on the Dec forms list: "Locks Fri 23 Oct, 18:00", "Locked", or nothing when there is no deadline. */
export function lockHeading(info: LockInfo | null | undefined, now: number = Date.now()): string | null {
  if (!info?.declarationsCloseAt) return null;
  return isLocked(info, now) ? tr('entries.deadline.locked') : tr('entries.deadline.locks', { when: lockMoment(info.declarationsCloseAt) });
}

/** The banner on a team's form: "Send by …" before it is sent, "Sent. You can change it until …" after. */
export function formBanner(sent: boolean, info: LockInfo | null | undefined): { text: string; tone: 'warn' | 'good' } {
  const when = info?.declarationsCloseAt ? lockMoment(info.declarationsCloseAt) : '';
  if (sent) return { text: when ? tr('entries.deadline.sentUntil', { when }) : tr('entries.deadline.sentOpen'), tone: 'good' };
  return { text: when ? tr('entries.deadline.sendBy', { when }) : tr('entries.deadline.notSent'), tone: 'warn' };
}
