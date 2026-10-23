import { TERMS_PLACEHOLDER, TERMS_PLACEHOLDER_LABEL, TERMS_TICK, TERMS_TICK_HELP } from '../lib/termsTick';

interface Props {
  /** The organiser's own terms; empty or missing shows the labelled placeholder instead. */
  termsText?: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** The one required tick on the sign-up form: parental consent plus the event terms, readable beside it. */
export function TermsTickBox({ termsText, checked, onChange }: Props) {
  const terms = termsText?.trim() ?? '';
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-start gap-3 text-[15px] leading-snug">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{TERMS_TICK}</span>
      </label>
      <details className="text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          {terms ? 'Read the event terms' : 'Read the event terms (placeholder)'}
        </summary>
        {terms ? (
          <p className="m-0 whitespace-pre-wrap break-words">{terms}</p>
        ) : (
          <p className="m-0">
            <strong>{TERMS_PLACEHOLDER_LABEL}.</strong> {TERMS_PLACEHOLDER}
          </p>
        )}
      </details>
      <p className="rf-note !p-0">{TERMS_TICK_HELP}</p>
    </div>
  );
}
