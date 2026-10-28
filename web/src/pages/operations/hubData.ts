import type { CompetitionDetail } from '../../types';
import { equipmentLines } from './equipment';
import { plural, type IssueGroup } from './readiness';
import type { CompetitionReadiness } from './types';

/** The tools that open as their own page under `operations/<tool>`. */
export type Tool = 'draw' | 'entries' | 'protests' | 'scorers' | 'volunteers' | 'safety' | 'tack' | 'passport' | 'import' | 'print' | 'results' | 'duplicate';

export const TOOL_TITLES: Record<Tool, string> = {
  draw: 'Draw',
  entries: 'Entries',
  protests: 'Protests',
  scorers: 'Scorers and team',
  volunteers: 'Volunteers',
  safety: 'Emergency contacts',
  tack: 'Tack check',
  passport: 'Passport check',
  import: 'Import teams',
  print: 'Print sheets',
  results: 'Results book',
  duplicate: 'Duplicate event',
};

export function isTool(value: string | undefined): value is Tool {
  return value !== undefined && Object.prototype.hasOwnProperty.call(TOOL_TITLES, value);
}

export interface SortRow { key: string; count: number; title: string; summary: string; to: string }

/** True once any session has started (status is no longer the scheduled default). */
export function eventHasStarted(competition: Pick<CompetitionDetail, 'sessions'>): boolean {
  return (competition.sessions ?? []).some((session) => session.status !== 0);
}

/** What is left to sort, from the readiness data: the rows (zero counts dropped) and the arena clashes that block publishing. */
export function sortRows(readiness: CompetitionReadiness, groups: IssueGroup[], base: string): { rows: SortRow[]; clashes: IssueGroup['items'] } {
  const clashes = groups.find((group) => group.id === 'clashes')?.items ?? [];
  const acknowledged = new Set(readiness.equipmentChecklist.filter((item) => item.acknowledged).map((item) => item.key));
  const equipmentToCheck = equipmentLines(readiness.equipmentChecklist).filter((line) => !line.keys.every((key) => acknowledged.has(key))).length;
  const unpaid = readiness.unpaidSignups.length;
  const missing = readiness.missingDeclarations.length;
  const short = readiness.incompleteTeams.length;
  const details = readiness.equipmentIssues.length;
  const rows: SortRow[] = [
    { key: 'unpaid', count: unpaid, title: 'Entries not paid', summary: `${plural(unpaid, 'entry', 'entries')} not paid`, to: `${base}/entries` },
    { key: 'missing', count: missing, title: 'Dec forms missing', summary: `${plural(missing, 'dec form')} missing`, to: `${base}/entries` },
    { key: 'short', count: short, title: 'Teams short of riders', summary: `${plural(short, 'team')} short of riders`, to: `${base}/teams` },
    { key: 'details', count: details, title: 'Races missing equipment details', summary: `${plural(details, 'race')} missing equipment details`, to: base },
    { key: 'equipment', count: equipmentToCheck, title: 'Equipment to check', summary: `${plural(equipmentToCheck, 'equipment item')} to check`, to: `${base}/equipment` },
  ];
  return { rows: rows.filter((row) => row.count > 0), clashes };
}

/** The total to sort, as shown on the hub and on the event home. */
export function sortTotal(readiness: CompetitionReadiness, groups: IssueGroup[], base: string): number {
  const { rows, clashes } = sortRows(readiness, groups, base);
  return rows.reduce((sum, row) => sum + row.count, 0) + clashes.length;
}

