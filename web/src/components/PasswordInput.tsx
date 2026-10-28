import { useState, type ChangeEventHandler, type KeyboardEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  autoComplete?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Names for the eye button. Default to "Show password" / "Hide password". */
  showLabel?: string;
  hideLabel?: string;
  /** For keys and other secrets that password managers and spell checkers should leave alone. */
  secret?: boolean;
}

/**
 * A password box with a 44px show/hide eye inside it and a quiet "Caps lock is on" note underneath. The browser's own
 * reveal and caps-lock icons are hidden in `skin.css` so they never sit on top of ours. Put it where a `.mg-field` would
 * go, inside a `Field` or under its own label.
 */
export function PasswordInput({ id, value, onChange, autoComplete, autoFocus, invalid, describedBy, showLabel, hideLabel, secret }: PasswordInputProps) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const capsId = `${id}-caps`;

  function sniff(event: KeyboardEvent<HTMLInputElement>) {
    const on = event.getModifierState?.('CapsLock');
    if (typeof on === 'boolean') setCaps(on);
  }

  return (
    <>
      <div className="mg-field" data-invalid={invalid || undefined}>
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={[describedBy, caps ? capsId : undefined].filter(Boolean).join(' ') || undefined}
          {...(secret ? { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } : {})}
          onChange={onChange}
          onKeyDown={sniff}
          onKeyUp={sniff}
          onBlur={() => setCaps(false)}
        />
        <button
          type="button"
          className="mg-eye"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? hideLabel ?? t('auth.password.hide') : showLabel ?? t('auth.password.show')}
          aria-pressed={shown}
        >
          {shown ? <EyeOff aria-hidden="true" className="h-5 w-5" /> : <Eye aria-hidden="true" className="h-5 w-5" />}
        </button>
      </div>
      {caps && <div id={capsId} role="status" className="mg-field-msg text-[13px] font-medium text-[rgb(var(--mg-muted))]">{t('auth.password.capsLock')}</div>}
    </>
  );
}
