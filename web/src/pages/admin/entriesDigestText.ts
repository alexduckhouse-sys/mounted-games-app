import { activeLocale, tr } from '../../i18n/translate';
import type { EntriesDigestRun } from './entriesDigestTypes';

export const people = (n: number) => tr('admin.email.people', { count: n });
export const events = (n: number) => tr('admin.email.events', { count: n });
const ukDay = (iso: string) => new Date(iso).toLocaleDateString(activeLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });

/** "Tonight, around 6pm", "Tomorrow evening, around 6pm" or "Sat 31 Oct, around 6pm", from when the evening run can next start. */
export function nextSendText(nextIso: string, now = new Date()): string {
  const next = new Date(nextIso);
  if (Number.isNaN(next.getTime())) return '';
  if (next.getTime() <= now.getTime()) return tr('admin.email.digest.dueNow');
  // Only compared with each other, so the locale doesn't matter.
  const day = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  if (day(next) === day(now)) return tr('admin.email.digest.tonight');
  if (day(next) === day(new Date(now.getTime() + 86_400_000))) return tr('admin.email.digest.tomorrow');
  return tr('admin.email.digest.dayAround', { day: ukDay(nextIso) });
}

/** One line on how the last email went. */
export function lastRunText(run: EntriesDigestRun): string {
  const when = ukDay(run.claimedAt);
  if (run.status === 0) return tr('admin.email.digest.goingOut', { when, people: people(run.total - run.remaining), total: run.total });
  const bits = [tr('admin.email.digest.runSent', { when, sent: run.sent })];
  if (run.skipped > 0) bits.push(tr('admin.email.digest.runSkipped', { skipped: run.skipped }));
  if (run.failed > 0) bits.push(tr('admin.email.digest.runFailed', { failed: run.failed }));
  return bits.join(', ') + '.';
}
