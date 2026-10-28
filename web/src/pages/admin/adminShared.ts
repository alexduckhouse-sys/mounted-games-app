import type { Stage } from '../../lib/adminStage';
import { tr } from '../../i18n/translate';
import type { MessageKey } from '../../i18n/en';
import type { CompetitionSummary } from '../../types';
import type { StatusTone } from '../refine/Refine';

export const STAGE_TONE: Record<Stage, StatusTone> = { draft: 'mut', entries: 'ok', format: 'warn', ready: 'ok', live: 'live', finished: 'mut' };

const STAGE_KEY: Record<Stage, MessageKey> = {
  draft: 'admin.accounts.stage.draft',
  entries: 'admin.accounts.stage.entries',
  format: 'admin.accounts.stage.format',
  ready: 'admin.accounts.stage.ready',
  live: 'common.live',
  finished: 'common.finished',
};

/** The stage's name in the language in use. */
export const stageLabel = (stage: Stage): string => tr(STAGE_KEY[stage]);

/** "6 upcoming · 14 past" */
export function stageCountsText(stages: readonly Stage[]): string {
  const past = stages.filter((s) => s === 'finished').length;
  return tr('admin.accounts.stage.counts', { upcoming: stages.length - past, past });
}

/** What deleting a competition takes with it, in words. */
export function deleteWarning(c: Pick<CompetitionSummary, 'teamCount' | 'sectionCount' | 'sessionCount'>, live: boolean): string {
  const counts = tr('admin.accounts.delete.counts', {
    teams: tr('admin.accounts.count.teams', { count: c.teamCount }),
    ageGroups: tr('admin.accounts.count.ageGroups', { count: c.sectionCount }),
    sessions: tr('admin.accounts.count.sessions', { count: c.sessionCount }),
  });
  return tr(live ? 'admin.accounts.delete.warningLive' : 'admin.accounts.delete.warning', { counts });
}
