import { useId } from 'react';

export interface RiderPrivacy { useInitialOnly: boolean; noFilming: boolean; agreed?: boolean }

/** Single "I agree" consent tick box for competition terms, rider & media consent. */
export function RiderPrivacyFields({ value, onChange, className = '' }: {
  value: RiderPrivacy;
  onChange: (patch: Partial<RiderPrivacy>) => void;
  className?: string;
}) {
  const id = useId();
  const checked = value.agreed ?? false;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={checked} aria-describedby={`${id}-consent`}
          onChange={(e) => onChange({ agreed: e.target.checked, useInitialOnly: false, noFilming: false })} />
        <span>
          <span className="font-semibold">I agree to the competition terms, rider &amp; media consent</span>
          <span id={`${id}-consent`} className="block text-slate-500 dark:text-slate-300">
            Confirms you agree to the competition rules, rider declaration and event photography/livestream terms.
          </span>
        </span>
      </label>
    </div>
  );
}
