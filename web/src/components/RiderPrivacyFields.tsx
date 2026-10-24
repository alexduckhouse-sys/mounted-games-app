import { TermsTickBox } from './TermsTickBox';

export interface RiderPrivacy { useInitialOnly: boolean; noFilming: boolean; agreed?: boolean }

/** Consent is separate from any privacy restrictions already recorded for a rider. */
export function RiderPrivacyFields({ value, onChange, termsText, className = '' }: {
  value: RiderPrivacy;
  onChange: (patch: Partial<RiderPrivacy>) => void;
  termsText?: string | null;
  className?: string;
}) {
  return <div className={className}>
    <TermsTickBox termsText={termsText} checked={value.agreed ?? false} onChange={(agreed) => onChange({ agreed })} />
  </div>;
}
