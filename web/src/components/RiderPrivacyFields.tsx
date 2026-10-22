import { useId } from 'react';

export interface RiderPrivacy { useInitialOnly: boolean; noFilming: boolean }

/** The two optional rider choices, both off unless ticked. */
export function RiderPrivacyFields({ value, onChange, className = '' }: {
  value: RiderPrivacy;
  onChange: (patch: Partial<RiderPrivacy>) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={value.useInitialOnly} aria-describedby={`${id}-initial`}
          onChange={(e) => onChange({ useInitialOnly: e.target.checked })} />
        <span>
          <span className="font-semibold">Show surname as an initial only</span>
          <span id={`${id}-initial`} className="block text-slate-500 dark:text-slate-300">
            Public pages show “Oliver S.” instead of “Oliver Smith”. Organisers still see the full name.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={value.noFilming} aria-describedby={`${id}-filming`}
          onChange={(e) => onChange({ noFilming: e.target.checked })} />
        <span>
          <span className="font-semibold">No close-up filming or photos</span>
          <span id={`${id}-filming`} className="block text-slate-500 dark:text-slate-300">
            The stream team is told to keep this rider out of close-ups.
          </span>
        </span>
      </label>
    </div>
  );
}
