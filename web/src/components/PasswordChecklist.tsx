import { Check, Circle } from 'lucide-react';
import { passwordRuleStatus } from '../lib/passwordRules';

/**
 * One row per password rule, ticking as the person types. Use it under any field where a password is chosen
 * and point the input's `aria-describedby` at `id`. Colour is never the only signal: a ticked row has a tick and
 * the words "met" for screen readers, and the polite live region only speaks when the count changes.
 */
export function PasswordChecklist({ password, id }: { password: string; id: string }) {
  const rows = passwordRuleStatus(password);
  const done = rows.filter((r) => r.met).length;
  const summary = done === rows.length
    ? 'All password requirements met.'
    : `${done} of ${rows.length} password requirements met.`;
  return (
    <div id={id}>
      <p className="m-0 mb-1.5 text-sm font-semibold text-[rgb(var(--mg-body))]">Your password needs:</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Password requirements">
        {rows.map(({ rule, met }) => (
          <li key={rule.id} data-met={met}
            className={`flex items-center gap-2 text-sm ${met ? 'font-semibold text-[rgb(var(--mg-ok))]' : 'text-[rgb(var(--mg-muted))]'}`}>
            {met
              ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" />
              : <Circle aria-hidden="true" className="h-4 w-4 shrink-0" />}
            <span>{rule.label}<span className="sr-only">{met ? ' (met)' : ' (not met yet)'}</span></span>
          </li>
        ))}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">{password === '' ? '' : summary}</p>
    </div>
  );
}
