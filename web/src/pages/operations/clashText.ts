import { tr } from '../../i18n/translate';
import type { TimetableClash } from '../../lib/timetableClashes';

/** The clashes that touch one session, whichever side of the clash it is on. */
export function clashesForSession(clashes: readonly TimetableClash[], sessionId: number): TimetableClash[] {
  return clashes.filter((clash) => clash.first.sessionId === sessionId || clash.second.sessionId === sessionId);
}

/** Why the two teams are tied together, in a few words. */
export function clashReason(clash: TimetableClash): string {
  if (clash.reason === 'pony') return tr('ops.clash.pony', { detail: clash.sharedDetail ?? tr('ops.clash.ponyFallback') });
  if (clash.reason === 'trainer') return tr('ops.clash.trainer', { detail: clash.sharedDetail ?? tr('ops.clash.trainerFallback') });
  return tr('ops.clash.together');
}
