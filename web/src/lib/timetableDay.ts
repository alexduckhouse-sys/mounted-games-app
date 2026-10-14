/** Dates in the timetable use the same local calendar as its displayed times. */
export function dayKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function defaultTimetableDay(days: string[], today: string): string {
  const ordered = [...new Set(days)].filter(Boolean).sort();
  return ordered.find((day) => day >= today) ?? ordered.at(-1) ?? today;
}
