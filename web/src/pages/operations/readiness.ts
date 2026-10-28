import type { CompetitionReadiness, DrawPreview } from './types';

export type IssueGroupId = 'clashes' | 'declarations' | 'payments' | 'teams' | 'equipment';

export interface IssueItem {
  key: string;
  /** Phone row title and sub-line. */
  title: string;
  detail: string;
  /** Desk table columns. */
  subject: string;
  section: string;
  note: string;
  to: string;
  action: string;
}

export interface IssueGroup {
  id: IssueGroupId;
  title: string;
  /** One-line explanation under the row title. */
  hint: string;
  /** Arena clashes are the only group the design marks as blocking publish. */
  blocks: boolean;
  /** Shown in the collapsed "Done" list once the group has no open items. */
  doneText: string;
  items: IssueItem[];
}

export function clock(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function money(minor: number): string {
  return (minor / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Every group is returned, including empty ones, so callers can list the finished checks too. */
export function buildIssueGroups(readiness: CompetitionReadiness, competitionId: number): IssueGroup[] {
  const base = `/competitions/${competitionId}`;
  return [
    {
      id: 'clashes', title: 'Arena clashes', hint: 'Sessions overlapping in an arena', blocks: true, doneText: 'No arena clashes',
      items: readiness.sessionOverlaps.map((item) => ({
        key: `o-${item.firstSessionId}-${item.secondSessionId}`,
        title: `${item.firstSessionName} overlaps ${item.secondSessionName}`,
        detail: item.arena,
        subject: `${item.firstSessionName} and ${item.secondSessionName}`,
        section: '—',
        note: [item.arena, [clock(item.startsAt), clock(item.endsAt)].filter(Boolean).join('–')].filter(Boolean).join(' · '),
        to: base,
        action: 'Open timetable',
      })),
    },
    {
      id: 'declarations', title: 'Missing declarations', hint: 'Teams without a declaration', blocks: false, doneText: 'Every team has a declaration',
      items: readiness.missingDeclarations.map((item) => ({
        key: `d-${item.teamId}`,
        title: `${item.teamName} needs a declaration`,
        detail: item.sectionName,
        subject: item.teamName,
        section: item.sectionName,
        note: 'Declaration not returned',
        to: `${base}/declarations`,
        action: 'Open declarations',
      })),
    },
    {
      id: 'payments', title: 'Unpaid entries', hint: 'Entries waiting for payment', blocks: false, doneText: 'No unpaid entries',
      items: readiness.unpaidSignups.map((item) => ({
        key: `u-${item.signupId}`,
        title: `Payment pending in ${item.sectionName}`,
        detail: `${money(item.amountMinor)} due`,
        subject: 'Payment pending',
        section: item.sectionName,
        note: `${money(item.amountMinor)} due`,
        to: `${base}/entries`,
        action: 'Open entries',
      })),
    },
    {
      id: 'teams', title: 'Incomplete teams', hint: 'Below the minimum riders', blocks: false, doneText: 'Every team has enough riders',
      items: readiness.incompleteTeams.map((item) => ({
        key: `i-${item.teamId}`,
        title: `${item.teamName} has ${item.declaredRiders} of ${item.minimumRiders} riders`,
        detail: item.sectionName,
        subject: item.teamName,
        section: item.sectionName,
        note: `${item.declaredRiders} of ${item.minimumRiders} riders declared`,
        to: `${base}/teams`,
        action: 'Open teams',
      })),
    },
    {
      id: 'equipment', title: 'Equipment details', hint: 'Races missing equipment details', blocks: false, doneText: 'Equipment details are complete',
      items: readiness.equipmentIssues.map((item) => ({
        key: `e-${item.raceName}`,
        title: `${item.raceName} needs equipment details`,
        detail: item.message,
        subject: item.raceName,
        section: '—',
        note: item.message,
        to: base,
        action: 'Open timetable',
      })),
    },
  ];
}

export function laneCount(preview: DrawPreview): number {
  let highest = 0;
  for (const session of preview.sessions) for (const heat of session.heats) for (const team of heat.teams) highest = Math.max(highest, team.laneIndex);
  return highest;
}

export function drawSubtitle(preview: DrawPreview): string {
  const lanes = laneCount(preview);
  return [
    plural(preview.fairness.teamCount, 'team'),
    lanes > 0 ? plural(lanes, 'lane') : null,
    plural(preview.sessions.length, 'round'),
  ].filter(Boolean).join(' · ');
}
