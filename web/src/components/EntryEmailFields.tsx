import { useId } from 'react';
import { CircleAlert } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { EMAIL_OPT_IN_TEXT, looksLikeEmail } from '../lib/emailOptIn';

export interface EntryEmail { email: string; optIn: boolean }

/**
 * The adult's email address for the entry confirmation, and the box for new-competition emails.
 * The box is never ticked for you and stays off until there is an address to send to.
 */
export function EntryEmailFields({ value, onChange }: {
  value: EntryEmail;
  onChange: (next: EntryEmail) => void;
}) {
  const id = useId();
  const { lang, t } = useLanguage();
  const trimmed = value.email.trim();
  const invalid = trimmed.length > 0 && !looksLikeEmail(trimmed);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="rf-fld">{t('entries.email.label')}
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          placeholder={t('entries.email.label')}
          value={value.email}
          aria-invalid={invalid}
          aria-describedby={`${id}-why`}
          onChange={(e) => {
            const email = e.target.value;
            onChange({ email, optIn: email.trim() ? value.optIn : false });
          }}
        />
      </label>
      <p id={`${id}-why`} className="m-0 text-xs text-slate-500 dark:text-slate-300">
        {t('entries.email.why')}
      </p>
      {invalid && <p role="alert" className="mg-field-msg m-0 text-xs font-semibold text-[rgb(var(--mg-elim))]"><CircleAlert aria-hidden="true" />{t('entries.form.emailInvalid')}</p>}
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
      {lang !== 'en' && <p className="m-0 text-xs text-slate-500 dark:text-slate-300">{t('entries.consent.glossLead')} {t('entries.email.optInGloss')}</p>}
    </div>
  );
}
