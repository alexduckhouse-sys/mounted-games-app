import { useId, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

interface FieldProps {
  label: ReactNode;
  /** Shown in red under the field, which also gets a red border. */
  error?: string | null;
  /** Sits on the same row as the error, dropping beneath it when there is no room (for example a "Forgot your password?" link). Shown even once the error clears. */
  errorAction?: ReactNode;
  className?: string;
  children: (props: { id: string; invalid: boolean; describedBy?: string }) => ReactNode;
}

/** A labelled field with its error underneath. The input itself comes from `children`. */
export function Field({ label, error, errorAction, className = '', children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const message = error && <span id={errorId} role="alert" className="mg-field-msg text-sm font-medium text-[rgb(var(--mg-elim))]"><CircleAlert aria-hidden="true" />{error}</span>;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-[rgb(var(--mg-body))]">{label}</label>
      {children({ id, invalid: !!error, describedBy: error ? errorId : undefined })}
      {errorAction ? (
        <div className={`flex flex-wrap items-center gap-x-3 ${error ? 'justify-between' : 'justify-end'}`}>
          {message}
          <span className="inline-flex min-h-11 items-center">{errorAction}</span>
        </div>
      ) : message}
    </div>
  );
}
