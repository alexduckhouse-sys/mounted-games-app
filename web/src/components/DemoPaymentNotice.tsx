import { Notice, type NoticeProps } from './Notice';
import { useT } from '../i18n/LanguageContext';
import type { MessageKey } from '../i18n/en';

/** What the person is paying for, or being paid for. Each one has its own sentence so French and Welsh can agree the wording. */
export type DemoPaymentKind = 'entry' | 'order' | 'payout';

const KEYS: Record<DemoPaymentKind, MessageKey> = {
  entry: 'common.demoPayment.entry',
  order: 'common.demoPayment.order',
  payout: 'common.demoPayment.payout',
};

export interface DemoPaymentNoticeProps extends Pick<NoticeProps, 'actionLabel' | 'actionTo' | 'onAction' | 'className'> {
  /** The thing the screen is about: `entry`, `order` (the event shop, which also sells stabling, hook-ups and shavings) or `payout`. */
  what: DemoPaymentKind;
}

/**
 * The strip that goes on every screen where someone pays, or is asked to pay: this is a demo, no money moves, and
 * the thing hasn't been paid for. Put it at the top of the payment step or just above the pay button. It is an
 * information strip, not announced on load, because it is part of the page rather than news.
 */
export function DemoPaymentNotice({ what, ...rest }: DemoPaymentNoticeProps) {
  const t = useT();
  return <Notice tone="info" role={null} {...rest}>{t(KEYS[what])}</Notice>;
}
