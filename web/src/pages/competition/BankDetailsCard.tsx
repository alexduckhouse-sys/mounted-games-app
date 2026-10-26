import { Landmark } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { bankDetailsText, type BankDetails } from '../../lib/bankDetails';

/**
 * Where to send the money, kept on the confirmation page: a bordered card that reads the same in every theme, with
 * each value in its own tap-to-select line and one button that copies the lot.
 */
export function BankDetailsCard({ details }: { details: BankDetails }) {
  const toast = useToast();

  async function copy() {
    try { await navigator.clipboard.writeText(bankDetailsText(details)); toast.show('Bank details copied'); } catch { /* the details are on screen to copy by hand */ }
  }

  const value = 'm-0 select-all break-words text-[17px] font-semibold leading-snug text-[rgb(var(--mg-ink))]';
  const label = 'text-[11px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]';
  return (
    <section aria-label="Bank transfer details" className="flex flex-col gap-3 rounded-[14px] border-[1.5px] border-[rgb(var(--mg-button))] bg-[rgb(var(--mg-tint)/.55)] p-4">
      <div className="flex items-center gap-2 text-[rgb(var(--mg-heading))]">
        <Landmark aria-hidden="true" className="h-5 w-5 shrink-0" />
        <h3 className="mg-display m-0 text-lg font-bold uppercase tracking-[0.04em]">Pay by bank transfer</h3>
      </div>
      <dl className="m-0 flex flex-col gap-3">
        {details.payTo
          ? <div className="flex flex-col gap-0.5"><dt className={label}>Pay to</dt><dd className={`${value} whitespace-pre-line font-mono text-base`}>{details.payTo}</dd></div>
          : <p className="m-0 text-sm text-[rgb(var(--mg-body))]">The organiser will send you their payment details.</p>}
        <div className="flex flex-col gap-0.5"><dt className={label}>Reference</dt><dd className={value}>{details.reference}</dd></div>
        <div className="flex flex-col gap-0.5"><dt className={label}>Amount</dt><dd className={`${value} mg-display text-2xl font-bold`}>{details.amount}</dd></div>
      </dl>
      <button type="button" className="sp-pill sp-pill-fill self-start" onClick={() => void copy()}>Copy bank details</button>
      {toast.node}
    </section>
  );
}
