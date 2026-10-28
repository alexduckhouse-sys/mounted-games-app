import type { MessageKey } from '../../i18n/en';
import type { Translate } from '../../i18n/translate';
import { roleKind, type DutyKind, type SlotSpec } from '../../lib/heatDuties';

const ROLE_KEY: Record<Exclude<DutyKind, 'custom'>, MessageKey> = {
  referee: 'duties.role.referee',
  starter: 'duties.role.starter',
  scorer: 'duties.role.scorer',
  line: 'duties.role.line',
  changeover: 'duties.role.changeover',
  ring: 'duties.role.ring',
  arena: 'duties.role.arena',
};

/** The role in the viewer's language. A job the organiser named themselves is shown as typed. */
export function roleLabel(slot: Pick<SlotSpec, 'role' | 'category'>, t: Translate): string {
  const kind = roleKind(slot);
  return kind === 'custom' ? slot.role : t(ROLE_KEY[kind]);
}

/** "Scorer" or "Line steward, lane 2". */
export function roleWithLane(slot: Pick<SlotSpec, 'role' | 'category' | 'lane'>, t: Translate): string {
  const label = roleLabel(slot, t);
  return slot.lane == null ? label : `${label}, ${t('duties.lane', { number: slot.lane }).toLowerCase()}`;
}
