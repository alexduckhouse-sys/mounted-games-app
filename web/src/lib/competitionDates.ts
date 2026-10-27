import { activeLocale } from '../i18n/translate.ts';

const dayOf = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const weekday = (d: Date) => d.toLocaleDateString(activeLocale(), { weekday: 'short' });
const month = (d: Date) => d.toLocaleDateString(activeLocale(), { month: 'short' });

/** "Sat 17 Oct", "Sat 17 – Sun 18 Oct" or "Sat 31 Oct – Sun 1 Nov"; the year is added when asked for. */
export function competitionDateText(start: string, end?: string | null, withYear = false): string {
  const from = dayOf(start);
  if (!from) return '';
  const to = end ? dayOf(end) : null;
  const year = withYear ? ` ${(to ?? from).getFullYear()}` : '';
  if (!to || sameDay(from, to) || to < from) return `${weekday(from)} ${from.getDate()} ${month(from)}${year}`;
  const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
  const left = sameMonth ? `${weekday(from)} ${from.getDate()}` : `${weekday(from)} ${from.getDate()} ${month(from)}`;
  return `${left} – ${weekday(to)} ${to.getDate()} ${month(to)}${year}`;
}

/** True when today falls between the first and last day, inclusive. */
export function isOnToday(start: string, end: string | null | undefined, now: Date): boolean {
  const from = dayOf(start);
  if (!from) return false;
  const to = (end ? dayOf(end) : null) ?? from;
  const key = (d: Date) => d.getFullYear() * 10_000 + d.getMonth() * 100 + d.getDate();
  return key(from) <= key(now) && key(now) <= key(to);
}
