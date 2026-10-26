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
  const ready = !!payoutsTo?.ready;
  return (
    <section aria-label="Payment and rules" className="flex flex-col">
      <StepHeading>Payment and rules</StepHeading>
      <div className="cw-card mt-3">
        <div className="cw-row" data-testid="payouts-to">
          <span className="cw-grow">
            <span className="cw-t1">Entry fees</span>
            <span className="cw-t2">{payoutsTo ? payoutsLine(payoutsTo) : 'Payouts go to your club once it has set them up.'}</span>
            <span className="cw-t2">Test mode: no real money moves yet.</span>
          </span>
          {!ready && (canSetUpPayouts
            ? <Link to="/me/payouts" className="cw-btn cw-btn-s">Set up payouts</Link>
            : <span className="cw-t2">Ask your club’s manager.</span>)}
        </div>
        <div className="cw-panel">
          <label className="cw-fld">How riders pay for now (optional)
            <input value={draft.paymentDestination} placeholder="Bank details or PayPal" autoComplete="off" onChange={(e) => change({ paymentDestination: e.target.value })} />
          </label>
          <label className="cw-fld">Notes for riders (optional)
            <textarea rows={3} value={draft.description} onChange={(e) => change({ description: e.target.value })} />
          </label>
          <label className="cw-fld">Terms and conditions (optional)
            <textarea rows={4} value={draft.termsText} maxLength={MAX_TERMS_LENGTH} placeholder="Paste or type your event terms. Plain text only."
              onChange={(e) => change({ termsText: e.target.value })} />
          </label>
        </div>
      </div>

      <SmallHead>Cards and checks</SmallHead>
      <div className="cw-card">
        <RefineSwitchRow label="Yellow and red cards" on={!!draft.cardsEnabled} onChange={(on) => change({ cardsEnabled: on })} />
        {canSetPassportCheck && <RefineSwitchRow label="Passport and vaccination check" on={!!draft.passportCheck} onChange={(on) => change({ passportCheck: on })} />}
      </div>
      {!canSetPassportCheck && <p className="cw-note">The passport and vaccination check is on the event details page once the competition exists.</p>}
    </section>
  );
}
