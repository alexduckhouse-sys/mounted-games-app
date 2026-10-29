import { TermsTickBox } from './TermsTickBox';

export interface RiderPrivacy { useInitialOnly: boolean; agreed?: boolean }

/** Consent is separate from any privacy restrictions already recorded for a rider. */
export function RiderPrivacyFields({ value, onChange, termsText, className = '' }: {
  value: RiderPrivacy;
  onChange: (patch: Partial<RiderPrivacy>) => void;
  termsText?: string | null;
  className?: string;
}) {
  return <div className={className}>
    <div className="sp-row">
      <span className="sp-grow"><span className="sp-t1">Show surname as initial only on public start lists and results</span><span className="sp-t2">For example, Oliver S.</span></span>
      <button type="button" role="switch" aria-label="Show surname as initial only on public start lists and results" aria-checked={value.useInitialOnly} className="rf-sw" onClick={() => onChange({ useInitialOnly: !value.useInitialOnly })}><span aria-hidden="true" /></button>
    </div>
    <TermsTickBox termsText={termsText} checked={value.agreed ?? false} onChange={(agreed) => onChange({ agreed })} />
  </div>;
}
