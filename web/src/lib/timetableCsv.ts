import type { Session, SessionKind as SessionKindType } from '../types';
import { SessionKind } from '../types';
import type { SessionTiming } from './time';
import { toCsv, downloadCsv, safeFilename } from './csv';

/** Flatten the live timetable into one CSV row per heat (or one row per break/briefing). */
export function exportTimetableCsv(
  competitionName: string,
  sessions: Session[],
  timings: Map<number, SessionTiming>,
): void {
  const header = ['Date', 'Time', 'Arena', 'Age group', 'Session', 'Heat', 'Status', 'Teams'];
  const rows: ReadonlyArray<string>[] = [];
  for (const s of sessions) {
    const t = timings.get(s.id);
    const kind = (s.kind ?? (s.isBreak ? SessionKind.Break : SessionKind.Race)) as SessionKindType;
    if (kind !== SessionKind.Race) {
      const when = t?.effective ?? t?.scheduled ?? null;
      rows.push([
        when ? when.toLocaleDateString() : '',
        when ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        s.arenaName ?? '',
        '',
        s.name,
        kind === SessionKind.Break ? 'BREAK' : kind === SessionKind.Briefing ? 'BRIEFING' : 'CUSTOM',
        '',
        '',
      ]);
      continue;
    }
    const heats = s.heats.slice().sort((a, b) => a.orderIndex - b.orderIndex);
    let foundLive = false;
    heats.forEach((h, i) => {
      const ht = t?.heats[i];
      const when = ht?.effective ?? ht?.scheduled ?? null;
      const complete = s.status === 2 || Boolean(h.finishedAt) || (h.races.length > 0 && h.races.every((r) => r.isComplete));
      const isLive = s.status === 1 && !complete && !foundLive;
      if (isLive) foundLive = true;
      rows.push([
        when ? when.toLocaleDateString() : '',
        when ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        s.arenaName ?? '',
        s.sectionName ?? '',
        s.name,
        h.label ?? `Heat ${i + 1}`,
        complete ? 'OVER' : isLive ? 'IN ARENA' : 'UPCOMING',
        h.entries.slice().sort((a, b) => a.laneIndex - b.laneIndex).map((e) => e.teamName).join(' | '),
      ]);
    });
  }
  downloadCsv(`${safeFilename(competitionName)}-timetable.csv`, toCsv(header, rows));
}
