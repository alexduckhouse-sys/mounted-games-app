import { useT } from '../../../i18n/LanguageContext';
import { Link } from 'react-router-dom';
import { MAX_TERMS_LENGTH } from '../../../lib/termsTick';
import type { CreatorDraft } from '../../../lib/creatorDraft';
import { payoutsLine } from '../../../lib/payouts';
import type { PayoutsTo } from '../../../types';
import { RefineSwitchRow } from '../../refine/Refine';
import { SmallHead, StepHeading } from './controls';
import type { StepProps } from './parts';

/**
 * Payment and rules: where entry fees are paid out (the organiser's club, read-only here), how riders pay for now, notes
 * for riders and the terms, then the switches for cards and the passport check.
 */
export function PaymentNotesStep({ draft, change, payoutsTo, canSetUpPayouts, canSetPassportCheck }: StepProps<CreatorDraft> & {
  payoutsTo: PayoutsTo | null;
  canSetUpPayouts: boolean;
  /** The passport check can be switched on here for a new competition; an existing one has it on its event details page. */
  canSetPassportCheck: boolean;
}) {
  const t = useT();
  const ready = !!payoutsTo?.ready;
  return (
    <section aria-label={t('admin.creator.step.payment')} className="flex flex-col">
      <StepHeading>{t('admin.creator.step.payment')}</StepHeading>
      <div className="cw-card mt-3">
        <div className="cw-row" data-testid="payouts-to">
          <span className="cw-grow">
            <span className="cw-t1">{t('admin.creator.pay.entryFees')}</span>
            <span className="cw-t2">{payoutsTo ? payoutsLine(payoutsTo) : t('admin.creator.payoutsPending')}</span>
            <span className="cw-t2">{t('admin.creator.pay.testMode')}</span>
          </span>
          {!ready && (canSetUpPayouts
            ? <Link to="/me/payouts" className="cw-btn cw-btn-s">{t('admin.creator.pay.setUp')}</Link>
            : <span className="cw-t2">{t('admin.creator.pay.askManager')}</span>)}
        </div>
        <div className="cw-panel">
          <label className="cw-fld">{t('admin.creator.pay.howPay')}
            <input value={draft.paymentDestination} placeholder={t('admin.creator.pay.bankPlaceholder')} autoComplete="off" onChange={(e) => change({ paymentDestination: e.target.value })} />
          </label>
          <label className="cw-fld">{t('admin.creator.pay.notes')}
            <textarea rows={3} value={draft.description} onChange={(e) => change({ description: e.target.value })} />
          </label>
          <label className="cw-fld">{t('admin.creator.pay.terms')}
            <textarea rows={4} value={draft.termsText} maxLength={MAX_TERMS_LENGTH} placeholder={t('admin.creator.pay.termsPlaceholder')}
              onChange={(e) => change({ termsText: e.target.value })} />
          </label>
        </div>
      </div>

      <SmallHead>{t('admin.creator.pay.cardsChecks')}</SmallHead>
      <div className="cw-card">
        <RefineSwitchRow label={t('admin.creator.pay.cards')} on={!!draft.cardsEnabled} onChange={(on) => change({ cardsEnabled: on })} />
        {canSetPassportCheck && <RefineSwitchRow label={t('admin.creator.pay.passport')} on={!!draft.passportCheck} onChange={(on) => change({ passportCheck: on })} />}
      </div>
      {!canSetPassportCheck && <p className="cw-note">{t('admin.creator.pay.passportNote')}</p>}
    </section>
  );
}
