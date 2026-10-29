import { tr } from '../../i18n/translate';
import type { SetTeamEntryStatusResult, TeamEntry, TeamEntryStatus } from './types';

/** A team about to be withdrawn, marked a no-show or reinstated. */
export interface StatusSheet { team: TeamEntry; next: TeamEntryStatus }

/** What changed when a team was withdrawn, marked a no-show or reinstated. */
export function statusMessage(sheet: StatusSheet, result: SetTeamEntryStatusResult): string {
  const places = result.heatPlacesChanged;
  const name = sheet.team.teamName;
  return sheet.next === 0
    ? (places > 0 ? tr('ops2.panel.backIn', { name, places: tr('ops2.panel.heats', { count: places }) }) : tr('ops2.panel.backInDraw', { name }))
    : (places > 0 ? tr('ops2.panel.outOf', { name, places: tr('ops2.panel.unscoredHeats', { count: places }) }) : tr('ops2.panel.isOut', { name }));
}
