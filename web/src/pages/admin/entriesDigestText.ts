import type { EntriesDigestRun } from './entriesDigestTypes';

export const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
export const events = (n: number) => `${n} ${n === 1 ? 'competition' : 'competitions'}`;
const ukDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });

/** "Tonight, around 6pm", "Tomorrow evening, around 6pm" or "Sat 31 Oct, around 6pm", from when the evening run can next start. */
export function nextSendText(nextIso: string, now = new Date()): string {
  const next = new Date(nextIso);
  if (Number.isNaN(next.getTime())) return '';
  if (next.getTime() <= now.getTime()) return 'Due now. It goes at the next check.';
  const day = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  if (day(next) === day(now)) return 'Tonight, around 6pm';
  if (day(next) === day(new Date(now.getTime() + 86_400_000))) return 'Tomorrow evening, around 6pm';
  return `${ukDay(nextIso)}, around 6pm`;
}

/** One line on how the last email went. */
export function lastRunText(run: EntriesDigestRun): string {
  const when = ukDay(run.claimedAt);
  if (run.status === 0) return `${when}: going out now. ${people(run.total - run.remaining)} of ${run.total} so far.`;
  const bits = [`${when}: ${run.sent} sent`];
  if (run.skipped > 0) bits.push(`${run.skipped} left out (unsubscribed or nothing still open)`);
  if (run.failed > 0) bits.push(`${run.failed} didn’t go through`);
  return bits.join(', ') + '.';
}
