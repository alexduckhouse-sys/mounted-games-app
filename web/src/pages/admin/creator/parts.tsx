import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Field } from '../../auth/Field';

/** Shared bits of the creator's steps: fields styled like the rest of the form, and numbers that only take digits. */

export const fieldClass = 'mg-field !rounded-lg';

/** The step's props: the draft, a way to change it, and any problems found when Next was pressed. */
export interface StepProps<D> {
  draft: D;
  change: (patch: Partial<D>) => void;
  problems: Record<string, string>;
  clear: (key: string) => void;
}

export function TextBox({ label, error, value, onChange, placeholder, hint, className = '', autoComplete = 'off', inputClass = '' }: {
  label: ReactNode; error?: string | null; value: string; onChange: (value: string) => void; placeholder?: string; hint?: ReactNode;
  className?: string; autoComplete?: string; inputClass?: string;
}) {
  return (
    <Field label={label} error={error} className={className}>
      {({ id, invalid, describedBy }) => (
        <>
          <div className={fieldClass} data-invalid={invalid}>
            <input id={id} value={value} placeholder={placeholder} autoComplete={autoComplete} aria-invalid={invalid} aria-describedby={describedBy}
              className={inputClass} onChange={(e) => onChange(e.target.value)} />
          </div>
          {hint && <span className="text-xs text-[rgb(var(--mg-muted))]">{hint}</span>}
        </>
      )}
    </Field>
  );
}

/** A number box that takes digits only (and one point when `decimal`): no `e`, `+` or `-`. */
export function NumberBox({ label, value, onChange, error, placeholder, suffix, prefix, decimal = false, hint, className = '', disabled }: {
  label: ReactNode; value: string; onChange: (value: string) => void; error?: string | null; placeholder?: string; suffix?: string; prefix?: string;
  decimal?: boolean; hint?: ReactNode; className?: string; disabled?: boolean;
}) {
  const clean = (raw: string) => {
    if (!decimal) return raw.replace(/\D/g, '');
    const [whole, ...rest] = raw.replace(/[^\d.]/g, '').split('.');
    return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
  };
  return (
    <Field label={label} error={error} className={className}>
      {({ id, invalid, describedBy }) => (
        <>
          <div className={`${fieldClass} !min-h-11`} data-invalid={invalid}>
            {prefix && <span aria-hidden="true" className="text-base font-medium text-[rgb(var(--mg-ink))]">{prefix}</span>}
            <input id={id} value={value} disabled={disabled} inputMode={decimal ? 'decimal' : 'numeric'} placeholder={placeholder} autoComplete="off" aria-invalid={invalid} aria-describedby={describedBy}
              onChange={(e) => onChange(clean(e.target.value))} />
            {suffix && <span className="text-sm text-[rgb(var(--mg-muted))]">{suffix}</span>}
          </div>
          {hint && <span className="text-xs text-[rgb(var(--mg-muted))]">{hint}</span>}
        </>
      )}
    </Field>
  );
}

export function SelectBox({ label, value, onChange, children, error, disabled, className = '', hint }: {
  label: ReactNode; value: string | number; onChange: (value: string) => void; children: ReactNode; error?: string | null; disabled?: boolean; className?: string; hint?: ReactNode;
}) {
  return (
    <Field label={label} error={error} className={className}>
      {({ id, invalid, describedBy }) => (
        <>
          <div className={`${fieldClass} relative !min-h-11`} data-invalid={invalid}>
            <select id={id} value={value} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)}
              className="appearance-none truncate pr-6 font-medium disabled:opacity-100">
              {children}
            </select>
            <ChevronDown aria-hidden="true" className={`pointer-events-none absolute right-3 h-4 w-4 text-[rgb(var(--mg-muted))] ${disabled ? 'opacity-40' : ''}`} />
          </div>
          {hint && <span className="text-xs text-[rgb(var(--mg-muted))]">{hint}</span>}
        </>
      )}
    </Field>
  );
}

/** A step's heading and the one line that says what it is for. */
export function StepIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="mg-display text-[28px] font-bold leading-none text-[rgb(var(--mg-heading))]">{title}</h2>
      {children && <p className="text-[15px] text-[rgb(var(--mg-muted))]">{children}</p>}
    </div>
  );
}

export function Pill({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'provisional' }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em] ${tone === 'provisional'
      ? 'bg-[rgb(var(--mg-live-row))] text-[rgb(var(--mg-heading))]' : 'bg-[rgb(var(--mg-done-bg))] text-[rgb(var(--mg-body))]'}`}>{children}</span>
  );
}
