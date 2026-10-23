import { Link } from 'react-router-dom';
import { MAX_TERMS_LENGTH } from '../../../lib/termsTick';
import type { CreatorDraft } from '../../../lib/creatorDraft';
import { payoutsLine } from '../../../lib/payouts';
import type { PayoutsTo } from '../../../types';
import { Field } from '../../auth/Field';
import { fieldClass, StepIntro, type StepProps } from './parts';

/**
 * Payment and notes: where entry fees are paid out (the organiser's club, read-only here), how riders pay for now,
 * notes for riders and the terms. Kept as its own step component so the payment part can change without touching
 * the rest of the wizard.
 */
export function PaymentNotesStep({ draft, change, payoutsTo, canSetUpPayouts }: StepProps<CreatorDraft> & {
  payoutsTo: PayoutsTo | null;
  canSetUpPayouts: boolean;
}) {
  return (
    <section aria-labelledby="cw-notes" className="flex flex-col gap-[18px]">
      <StepIntro title="Payment and notes">All optional. You can change these later.</StepIntro>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-[rgb(var(--mg-body))]">Where entry fees go</span>
        <div className="mg-card flex flex-col gap-1 px-3.5 py-3 text-base" data-testid="payouts-to">
          {payoutsTo?.ready ? (
            <p>{payoutsLine(payoutsTo)}</p>
          ) : (
            <p>
              {payoutsTo ? payoutsLine(payoutsTo) : 'Payouts go to your club once it has set them up.'}{' '}
              {canSetUpPayouts
                ? <Link to="/me/payouts" className="mg-text-link font-semibold">Set up payouts</Link>
                : <span className="text-[rgb(var(--mg-muted))]">Ask your club&rsquo;s manager to set them up.</span>}
            </p>
          )}
          <p className="text-sm text-[rgb(var(--mg-muted))]">Test mode: no real money moves yet.</p>
        </div>
      </div>
      <Field label={<>How riders pay for now <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></>}>
        {({ id }) => (
          <div className={fieldClass}>
            <input id={id} value={draft.paymentDestination} placeholder="Bank details or PayPal" autoComplete="off" onChange={(e) => change({ paymentDestination: e.target.value })} />
          </div>
        )}
      </Field>
      <Field label={<>Notes for riders <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></>}>
        {({ id }) => (
          <div className={`${fieldClass} !items-start`}>
            <textarea id={id} rows={3} value={draft.description} onChange={(e) => change({ description: e.target.value })}
              className="min-h-[92px] w-full min-w-0 flex-1 resize-y border-0 bg-transparent py-3 font-[inherit] text-base text-[rgb(var(--mg-ink))] outline-none" />
          </div>
        )}
      </Field>
      <Field label={<>Terms and conditions <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></>}>
        {({ id }) => (
          <div className={`${fieldClass} !items-start`}>
            <textarea id={id} rows={4} value={draft.termsText} maxLength={MAX_TERMS_LENGTH} placeholder="Paste or type your event terms. Plain text only."
              onChange={(e) => change({ termsText: e.target.value })}
              className="min-h-[92px] w-full min-w-0 flex-1 resize-y border-0 bg-transparent py-3 font-[inherit] text-base text-[rgb(var(--mg-ink))] outline-none" />
          </div>
        )}
      </Field>
    </section>
  );
}
