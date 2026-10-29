import type { CompetitionSummary } from '../types';

export type Stage = 'draft' | 'entries' | 'format' | 'ready' | 'live' | 'finished';

export const STAGE_LABEL: Record<Stage, string> = {
  draft: 'Draft',
  entries: 'Entries open',
  format: 'Build timetable',
  ready: 'Ready to run',
  live: 'Live',
  finished: 'Finished',
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Where a competition has got to, worked out from the counts the list already has:
 * no age groups is a draft; age groups with no teams is taking entries; teams but no timetable still needs its format;
 * a timetable is ready to run, and live on the day itself. Anything that ended before today is finished.
 */
export function stageOf(c: Pick<CompetitionSummary, 'startDate' | 'endDate' | 'isArchived' | 'sectionCount' | 'teamCount' | 'sessionCount' | 'heatedSessionCount'>, now: Date): Stage {
  const start = new Date(c.startDate);
  const end = new Date(c.endDate ?? c.startDate);
  const today = startOfDay(now);
  if (c.isArchived || (!Number.isNaN(end.getTime()) && startOfDay(end) < today)) return 'finished';
  const onToday = !Number.isNaN(start.getTime()) && startOfDay(start) <= today && (Number.isNaN(end.getTime()) || today <= startOfDay(end));
  if ((c.heatedSessionCount ?? c.sessionCount) > 0) return onToday ? 'live' : 'ready';
  if (c.teamCount > 0) return 'format';
  return c.sectionCount > 0 ? 'entries' : 'draft';
}

/** The one button on a competition's row: the next job for that stage. */
export function stageAction(stage: Stage, id: number): { label: string; to: string } {
  switch (stage) {
    case 'live': return { label: 'Run day', to: `/competitions/${id}` };
    case 'format':
    case 'ready': return { label: 'Before the day', to: `/competitions/${id}/operations` };
    case 'finished': return { label: 'Results', to: `/competitions/${id}/toplists` };
    default: return { label: 'Edit', to: `/admin/competitions/${id}` };
  }
}

/** "6 upcoming · 14 past" */
export function stageCounts(stages: readonly Stage[]): string {
  const past = stages.filter((s) => s === 'finished').length;
  return `${stages.length - past} upcoming · ${past} past`;
}
