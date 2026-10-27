import type { MessageKey } from '../i18n/en';
import type { Translate } from '../i18n/translate';
import { effectiveStatus, RESULT_STATUS } from './resultStatus';

const KEYS: Record<number, MessageKey> = {
  [RESULT_STATUS.Eliminated]: 'teams.team.eliminated',
  [RESULT_STATUS.DidNotStart]: 'teams.team.didNotStart',
  [RESULT_STATUS.DidNotFinish]: 'teams.team.didNotFinish',
  [RESULT_STATUS.Retired]: 'teams.team.retired',
};

/** "Eliminated", "Did not start" and so on in the chosen language; null for a team that finished. The letters (E, DNS, DNF, R) stay as they are. */
export function resultStatusLabel(t: Translate, eliminated: boolean, status?: number | null): string | null {
  if (!eliminated) return null;
  return t(KEYS[effectiveStatus(eliminated, status)] ?? 'teams.team.eliminated');
}
