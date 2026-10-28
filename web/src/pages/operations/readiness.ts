import type { CompetitionReadiness, DrawPreview } from './types';
import { activeLocale, tr } from '../../i18n/translate';

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
  return date.toLocaleTimeString(activeLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function money(minor: number): string {
  return (minor / 100).toLocaleString(activeLocale(), { style: 'currency', currency: 'GBP' });
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Every group is returned, including empty ones, so callers can list the finished checks too. */
export function buildIssueGroups(readiness: CompetitionReadiness, competitionId: number): IssueGroup[] {
  const base = `/competitions/${competitionId}`;
  return [
    {
      id: 'clashes', title: tr('ops.ready.clashes'), hint: tr('ops.ready.clashesHint'), blocks: true, doneText: tr('ops.ready.clashesDone'),
      items: readiness.sessionOverlaps.map((item) => ({
        key: `o-${item.firstSessionId}-${item.secondSessionId}`,
        title: tr('ops.ready.overlaps', { first: item.firstSessionName, second: item.secondSessionName }),
        detail: item.arena,
        subject: tr('ops.ready.overlapSubject', { first: item.firstSessionName, second: item.secondSessionName }),
        section: '—',
        note: [item.arena, [clock(item.startsAt), clock(item.endsAt)].filter(Boolean).join('–')].filter(Boolean).join(' · '),
        to: base,
        action: tr('ops.ready.openTimetable'),
      })),
    },
    {
      id: 'declarations', title: tr('ops.ready.decls'), hint: tr('ops.ready.declsHint'), blocks: false, doneText: tr('ops.ready.declsDone'),
      items: readiness.missingDeclarations.map((item) => ({
        key: `d-${item.teamId}`,
        title: tr('ops.ready.needsDecl', { team: item.teamName }),
        detail: item.sectionName,
        subject: item.teamName,
        section: item.sectionName,
        note: tr('ops.ready.declNote'),
        to: `${base}/declarations`,
        action: tr('ops.ready.openDecls'),
      })),
    },
    {
      id: 'payments', title: tr('ops.ready.payments'), hint: tr('ops.ready.paymentsHint'), blocks: false, doneText: tr('ops.ready.paymentsDone'),
      items: readiness.unpaidSignups.map((item) => ({
        key: `u-${item.signupId}`,
        title: tr('ops.ready.paymentPending', { section: item.sectionName }),
        detail: tr('ops.ready.due', { amount: money(item.amountMinor) }),
        subject: tr('ops.ready.paymentSubject'),
        section: item.sectionName,
        note: tr('ops.ready.due', { amount: money(item.amountMinor) }),
        to: `${base}/entries`,
        action: tr('ops.ready.openEntries'),
      })),
    },
    {
      id: 'teams', title: tr('ops.ready.teams'), hint: tr('ops.ready.teamsHint'), blocks: false, doneText: tr('ops.ready.teamsDone'),
      items: readiness.incompleteTeams.map((item) => ({
        key: `i-${item.teamId}`,
        title: tr('ops.ready.teamShort', { team: item.teamName, declared: item.declaredRiders, minimum: item.minimumRiders }),
        detail: item.sectionName,
        subject: item.teamName,
        section: item.sectionName,
        note: tr('ops.ready.teamNote', { declared: item.declaredRiders, minimum: item.minimumRiders }),
        to: `${base}/teams`,
        action: tr('ops.ready.openTeams'),
      })),
    },
    {
      id: 'equipment', title: tr('ops.ready.equipment'), hint: tr('ops.ready.equipmentHint'), blocks: false, doneText: tr('ops.ready.equipmentDone'),
      items: readiness.equipmentIssues.map((item) => ({
        key: `e-${item.raceName}`,
        title: tr('ops.ready.needsEquipment', { race: item.raceName }),
        detail: item.message,
        subject: item.raceName,
        section: '—',
        note: item.message,
        to: base,
        action: tr('ops.ready.openTimetable'),
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
    tr('ops.count.team', { count: preview.fairness.teamCount }),
    lanes > 0 ? tr('ops.count.lane', { count: lanes }) : null,
    tr('ops.count.round', { count: preview.sessions.length }),
  ].filter(Boolean).join(' · ');
}
