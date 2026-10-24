import { Check, Circle } from 'lucide-react';
import { passwordRuleStatus } from '../lib/passwordRules';

/**
 * Shows the single most important remaining password rule as the person types, one at a time.
 * Once every rule is met, shows a ticked confirmation.
 */
export function PasswordChecklist({ password, id }: { password: string; id: string }) {
  const rows = passwordRuleStatus(password);
  const nextUnmet = rows.find((r) => !r.met) ?? null;
  const summary = password === ''
    ? ''
    : nextUnmet
      ? `Next requirement: ${nextUnmet.rule.label}.`
      : 'All password requirements met.';
  return (
    <div id={id}>
      {password !== '' && (
        nextUnmet ? (
          <p data-met="false" className="m-0 flex items-center gap-2 text-sm text-[rgb(var(--mg-muted))]">
            <Circle aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{nextUnmet.rule.label}<span className="sr-only"> (not met yet)</span></span>
          </p>
        ) : (
          <p data-met="true" className="m-0 flex items-center gap-2 text-sm font-semibold text-[rgb(var(--mg-ok))]">
            <Check aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>Password meets all requirements.<span className="sr-only"> (met)</span></span>
          </p>
        )
      )}
      <p className="sr-only" role="status" aria-live="polite">{summary}</p>
    </div>
  );
}
