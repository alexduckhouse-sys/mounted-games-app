import { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { EMAIL_OPT_IN_TEXT, looksLikeEmail } from '../lib/emailOptIn';

export interface EntryEmail { email: string; optIn: boolean }

/**
 * The adult's email address for the entry confirmation, and the box for new-competition emails.
 * The box is never ticked for you and stays off until there is an address to send to.
 */
export function EntryEmailFields({ value, onChange, submitted = false }: {
  value: EntryEmail;
  onChange: (next: EntryEmail) => void;
  submitted?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [touched, setTouched] = useState(() => value.email.trim().length > 0);
  const trimmed = value.email.trim();
  const invalid = trimmed.length > 0 && !looksLikeEmail(trimmed);
  useEffect(() => {
    if (!invalid || touched) return;
    const onOutsidePointer = (event: Event) => {
      if (inputRef.current && event.target instanceof Node && !inputRef.current.contains(event.target)) {
        setTouched(true);
      }
    };
    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('mousedown', onOutsidePointer, true);
    document.addEventListener('click', onOutsidePointer, true);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointer, true);
      document.removeEventListener('mousedown', onOutsidePointer, true);
      document.removeEventListener('click', onOutsidePointer, true);
    };
  }, [invalid, touched]);
  const showError = invalid && (touched || submitted);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="rf-fld">Your email (optional)
        <input
          ref={inputRef}
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          placeholder="Your email (optional)"
          value={value.email}
          aria-invalid={showError}
          aria-describedby={`${id}-why`}
          onBlur={() => {
            if (value.email.trim().length > 0) setTouched(true);
          }}
          onChange={(e) => {
            const email = e.target.value;
            if (!email.trim()) setTouched(false);
            onChange({ email, optIn: email.trim() ? value.optIn : false });
          }}
        />
      </label>
      <p id={`${id}-why`} className="m-0 text-xs text-slate-500 dark:text-slate-300">
        We'll send you one email to confirm your entry. It goes to you, the adult entering, and never to a rider.
      </p>
      {showError && <p role="alert" className="mg-field-msg m-0 text-xs font-semibold text-[rgb(var(--mg-elim))]"><CircleAlert aria-hidden="true" />That email address doesn’t look right.</p>}
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={value.optIn}
          disabled={!trimmed || invalid}
          onChange={(e) => onChange({ ...value, optIn: e.target.checked })}
        />
        <span>{EMAIL_OPT_IN_TEXT}</span>
      </label>
    </div>
  );
}
