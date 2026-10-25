import { useId, type ReactNode } from 'react';

interface FieldProps {
  label: ReactNode;
  /** Shown in red under the field, which also gets a red border. */
  error?: string | null;
  className?: string;
  children: (props: { id: string; invalid: boolean; describedBy?: string }) => ReactNode;
}

/** A labelled field with its error underneath. The input itself comes from `children`. */
export function Field({ label, error, className = '', children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-[rgb(var(--mg-body))]">{label}</label>
      {children({ id, invalid: !!error, describedBy: error ? errorId : undefined })}
      {error && <span id={errorId} role="alert" className="mg-field-msg text-sm font-medium text-[rgb(var(--mg-elim))]">{error}</span>}
    </div>
  );
}
