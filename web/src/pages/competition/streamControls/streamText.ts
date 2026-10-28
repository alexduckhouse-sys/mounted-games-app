import type { MessageKey } from '../../../i18n/en';
import type { Translate } from '../../../i18n/translate';
import { PODIUM_SECONDS, FAVOURITES_SECONDS, TITLE_SECONDS, TOPLIST_SECONDS, type AutoRule, type AutoRuleKey, type AutoState } from '../../../lib/streamAuto';
import type { OverlayTileId } from '../../../lib/streamOverlayTiles';
import type { LiveStream } from '../../../types';

/**
 * Words for the stream desks that the shared `lib/` helpers still hold in English (tile names, automation rules,
 * lengths). They are resolved here, at render time, so the language switch applies.
 */

/** "30s" or "2 min". */
export function lengthText(t: Translate, seconds: number): string {
  return seconds >= 60 && seconds % 60 === 0 ? t('desk.stream.min', { count: seconds / 60 }) : t('desk.stream.sec', { count: seconds });
}

export function tileText(t: Translate, id: OverlayTileId | 'off'): string {
  return t(`desk.stream.tile.${id}` as MessageKey);
}

export function qualityText(t: Translate, preset: string): string {
  return t(`desk.stream.quality.${preset}` as MessageKey);
}

/** "3 watching · Live". */
export function cameraStatusText(t: Translate, stream: Pick<LiveStream, 'viewerCount' | 'status'>): string {
  return t('desk.stream.watching', { viewers: stream.viewerCount, state: stream.status === 1 ? t('desk.stream.paused') : t('desk.stream.stateLive') });
}

export function autoStatusText(t: Translate, state: AutoState, nextRaceName: string | null): string {
  if (!state.on) return t('desk.stream.auto.statusOff');
  if (state.rules.race.on && nextRaceName) return t('desk.stream.auto.statusNext', { name: nextRaceName });
  return t('desk.stream.auto.statusOn');
}

/** The words for one automation rule: when it runs, what it does, and its choices. */
export function autoRuleText(t: Translate, key: AutoRuleKey, rule: AutoRule) {
  const when = t(`desk.stream.auto.${key}.when` as MessageKey);
  const choiceLabel = key === 'race' || key === 'sponsor' ? t('desk.stream.auto.race.choiceLabel') : key === 'toplist' ? t('desk.stream.auto.toplist.choiceLabel') : '';
  let what: string;
  if (key === 'race') what = t('desk.stream.auto.race.what', { n: rule.n });
  else if (key === 'toplist') what = rule.n === 1 ? t('desk.stream.auto.toplist.whatOne', { seconds: TOPLIST_SECONDS }) : t('desk.stream.auto.toplist.whatMany', { n: rule.n, seconds: TOPLIST_SECONDS });
  else if (key === 'podium') what = t('desk.stream.auto.podium.what', { seconds: PODIUM_SECONDS });
  else if (key === 'title') what = t('desk.stream.auto.title.what', { seconds: TITLE_SECONDS });
  else if (key === 'favourites') what = t('desk.stream.auto.favourites.what', { seconds: FAVOURITES_SECONDS });
  else what = t('desk.stream.auto.sponsor.what', { n: rule.n });
  return { when, what, choiceLabel };
}

export function autoChoiceText(t: Translate, key: AutoRuleKey, n: number): string {
  if (key === 'toplist') return n === 1 ? t('desk.stream.auto.toplist.everyRace') : t('desk.stream.auto.toplist.everyN', { n });
  return t('desk.stream.sec', { count: n });
}
