import { MAX_TERMS_LENGTH } from '../../../lib/termsTick';
import type { CreatorDraft } from '../../../lib/creatorDraft';
import { Field } from '../../auth/Field';
import { fieldClass, StepIntro, type StepProps } from './parts';

/**
 * Payment and notes: where entry fees go, notes for riders and the terms. Kept as its own step component so the
 * club payouts change can replace the payment part without touching the rest of the wizard.
 */
export function PaymentNotesStep({ draft, change }: StepProps<CreatorDraft>) {
  return (
    <section aria-labelledby="cw-notes" className="flex flex-col gap-[18px]">
      <StepIntro title="Payment and notes">All optional. You can change these later.</StepIntro>
      <Field label={<>Where entry fees go <span className="font-normal text-[rgb(var(--mg-muted))]">(optional)</span></>}>
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
