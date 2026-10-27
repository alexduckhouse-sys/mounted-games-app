import { Check, Circle } from 'lucide-react';
import { useT } from '../i18n/LanguageContext';
import { passwordRuleStatus } from '../lib/passwordRules';

/**
 * Shows the single most important remaining password rule as the person types, one at a time.
 * Once every rule is met, shows a ticked confirmation.
 */
export function PasswordChecklist({ password, id }: { password: string; id: string }) {
  const t = useT();
  const rows = passwordRuleStatus(password);
  const nextUnmet = rows.find((r) => !r.met) ?? null;
  const summary = password === ''
    ? ''
    : nextUnmet
      ? t('auth.pw.next', { rule: nextUnmet.rule.label })
      : t('auth.pw.allMet');
  return (
    <div id={id}>
      {password !== '' && (
        nextUnmet ? (
          <p data-met="false" className="m-0 flex items-center gap-2 text-sm text-[rgb(var(--mg-muted))]">
            <Circle aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{nextUnmet.rule.label}<span className="sr-only"> {t('auth.pw.notMetYet')}</span></span>
          </p>
        ) : (
          <p data-met="true" className="m-0 flex items-center gap-2 text-sm font-semibold text-[rgb(var(--mg-ok))]">
            <Check aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{t('auth.pw.meets')}<span className="sr-only"> {t('auth.pw.met')}</span></span>
          </p>
        )
      )}
      <p className="sr-only" role="status" aria-live="polite">{summary}</p>
    </div>
  );
}
