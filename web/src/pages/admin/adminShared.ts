import type { Stage } from '../../lib/adminStage';
import type { CompetitionSummary } from '../../types';
import type { StatusTone } from '../refine/Refine';

export const STAGE_TONE: Record<Stage, StatusTone> = { draft: 'mut', entries: 'ok', format: 'warn', ready: 'ok', live: 'live', finished: 'mut' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What deleting a competition takes with it, in words. */
export function deleteWarning(c: Pick<CompetitionSummary, 'teamCount' | 'sectionCount' | 'sessionCount'>, live: boolean): string {
  const counts = `${plural(c.teamCount, 'team')}, ${plural(c.sectionCount, 'age group')} and ${plural(c.sessionCount, 'session')}`;
  return `${live ? 'It’s running now. ' : ''}Its ${counts}, and every entry, dec form, heat, result and chat message go with it. This can’t be undone.`;
}
