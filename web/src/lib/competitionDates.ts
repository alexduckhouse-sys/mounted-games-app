const ukDateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dayOf = (iso: string) => {
  const trimmed = iso.trim();
  const midnightMatch = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0+)?)?Z?)?$/i.exec(trimmed);
  if (midnightMatch) {
    const y = Number(midnightMatch[1]);
    const m = Number(midnightMatch[2]);
    const d = Number(midnightMatch[3]);
    const date = new Date(y, m - 1, d, 12, 0, 0);
    return Number.isNaN(date.getTime()) || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d
      ? null
      : date;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parts = ukDateParts.formatToParts(date);
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const m = Number(parts.find((p) => p.type === 'month')?.value);
    const d = Number(parts.find((p) => p.type === 'day')?.value);
    if (y && m && d) return new Date(y, m - 1, d, 12, 0, 0);
  }
  return date;
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const weekday = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short' });
const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short' });

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
