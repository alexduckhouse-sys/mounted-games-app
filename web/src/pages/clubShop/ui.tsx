import { useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import { initialsOf } from '../../lib/profile';
import './clubShop.css';

export type ChipTone = 'good' | 'warn' | 'bad' | 'grey' | 'plain';

/** A small status chip: the word carries the meaning, the tone only reinforces it. */
export function Chip({ tone = 'plain', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className="cs-chip" data-tone={tone}>{children}</span>;
}

/** A person's initials in a circle. */
export function Avatar({ name }: { name: string }) {
  return <span aria-hidden="true" className="cs-ava">{initialsOf(name)}</span>;
}

export interface PickOption { value: string; label: string; disabled?: boolean }

/**
 * A sheet that lists choices with the current one ticked. Picking one slides the sheet away, then calls `onPick`.
 * `footer` sits under the list, for a red "Remove" action.
 */
export function PickSheet({ title, description, options, value, onPick, onClose, footer }: {
  title: string;
  description?: string;
  options: PickOption[];
  value: string | null;
  onPick: (value: string) => void;
  onClose: () => void;
  footer?: (close: () => void) => ReactNode;
}) {
  return (
    <Sheet title={title} description={description} onClose={onClose}>
      {({ close }) => (
        <>
          <div className="cs-opts" role="radiogroup" aria-label={title}>
            {options.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={option.value === value} disabled={option.disabled}
                className="cs-opt" onClick={() => close(() => { onClose(); onPick(option.value); })}>
                {option.label}
                {option.value === value && <Check aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2.75} />}
              </button>
            ))}
          </div>
          {footer?.(() => close())}
        </>
      )}
    </Sheet>
  );
}

/** A settings row (label on the left, current choice and › on the right) that opens a `PickSheet`. */
export function PickRow({ label, value, options, onPick, placeholder = '' }: {
  label: string;
  value: string | null;
  options: PickOption[];
  onPick: (value: string) => void;
  /** Shown on the right when nothing is chosen, e.g. for a row that only ever runs an action. */
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value)?.label ?? placeholder;
  return (
    <>
      <button type="button" className="flex min-h-14 w-full items-center gap-3 bg-[rgb(var(--mg-surface))] px-4 text-left disabled:opacity-60"
        aria-label={current ? `${label}: ${current}` : label} aria-haspopup="dialog" disabled={options.length === 0} onClick={() => setOpen(true)}>
        <span className="flex-1 text-base font-semibold text-[rgb(var(--mg-ink))]">{label}</span>
        {current && <span className="max-w-[60%] truncate text-base text-[rgb(var(--mg-heading))]">{current}</span>}
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]" strokeWidth={2.5} />
      </button>
      {open && <PickSheet title={label} options={options} value={value} onPick={onPick} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * A sheet with a small form and one go-ahead pill. `onSave` returns whether it worked; the sheet slides away only
 * then, and stays open with `error` showing when it didn't.
 */
export function FormSheet({ title, description, saveLabel = 'Done', canSave = true, onSave, onClose, error, extra, children }: {
  title: string;
  description?: string;
  saveLabel?: string;
  canSave?: boolean;
  onSave: () => Promise<boolean> | boolean;
  onClose: () => void;
  error?: string | null;
  /** Extra actions under the pill, such as a red "Remove". */
  extra?: ReactNode;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} description={description} onClose={onClose}>
      {({ close }) => {
        async function submit(event: FormEvent) {
          event.preventDefault();
          if (busy || !canSave) return;
          setBusy(true);
          try {
            if (await onSave()) close();
          } finally {
            setBusy(false);
          }
        }
        return (
          <form className="kit-sheet-inner" onSubmit={(event) => { void submit(event); }} noValidate>
            {children}
            {error && <p role="alert" className="cs-field-error m-0">{error}</p>}
            <div className="kit-acts">
              <button type="submit" className="kit-pill kit-pill-fill" disabled={busy || !canSave}>{busy ? 'Saving…' : saveLabel}</button>
              {extra}
            </div>
          </form>
        );
      }}
    </Sheet>
  );
}

/** A labelled box in a sheet. The hint and the problem sit outside the label, so the label is just its name. */
export function SheetField({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="cs-fieldwrap">
      <label className="kit-sheet-field">
        {label}
        {children}
      </label>
      {hint && <small className="cs-hint">{hint}</small>}
      {error && <span role="alert" className="cs-field-error">{error}</span>}
    </div>
  );
}
