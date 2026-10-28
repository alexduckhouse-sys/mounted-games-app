import { useState, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useT } from '../../../i18n/LanguageContext';
import './wizard.css';


/** Small controls shared by the creator's steps. The dropdown rows, switches, menus and calendar come from `pages/refine/Refine.tsx`. */

/** A step's heading. */
export function StepHeading({ children }: { children: ReactNode }) {
  return <h2 className="cw-h">{children}</h2>;
}

/** The navy line and big name that start each age group's part of a step. */
export function SecHead({ name, first = false, sub }: { name: string; first?: boolean; sub?: ReactNode }) {
  return (
    <div className={`cw-sechead ${first ? 'first' : ''}`.trim()}>
      <h3>{name}</h3>
      {sub != null && <span className="cw-sub">{sub}</span>}
    </div>
  );
}

/** A small uppercase heading for a group inside a step, with something on the right (an Edit button, a count). */
export function SmallHead({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <h3 className="cw-sec">{children}{aside != null && <span>{aside}</span>}</h3>;
}

/** A full-width grey bar for adding something. */
export function AddBar({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="cw-addbar" disabled={disabled} onClick={onClick}>
      <Plus className="h-4 w-4" aria-hidden="true" />{children}
    </button>
  );
}

/** The same bar, at the foot of a card of rows. */
export function AddRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="cw-addrow" onClick={onClick}>
      <Plus className="h-4 w-4" aria-hidden="true" />{children}
    </button>
  );
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Round - and + with the number between them. The number can be typed too, and is kept between `min` and `max`.
 * `value` is the draft's text: empty shows the `empty` placeholder, and + from empty goes to `start`.
 * Whole numbers by default; `decimals` lets pence be typed (the price). With `min` 0, emptying the box or stepping
 * down to 0 reports 0, which the caller can show as `empty` ("No limit").
 */
export function Stepper({ name, value, min, max, step = 1, onChange, empty = '–', start, decimals = 0, width }: {
  name: string; value: string; min: number; max: number; step?: number; onChange: (next: number) => void; empty?: string; start?: number;
  decimals?: number; width?: number;
}) {
  const t = useT();
  const places = 10 ** decimals;
  const round = (n: number) => Math.round(n * places) / places;
  const parsed = parseFloat(value);
  const has = Number.isFinite(parsed);
  const now = has ? round(parsed) : null;
  // What is being typed, kept while it reads as the same number as the draft so "12." and "12.50" aren't rewritten under the cursor.
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <span className="cw-stp" role="group" aria-label={name}>
      <button type="button" aria-label={t('admin.creator.stepper.less', { name })} disabled={now === null || now <= min} onClick={() => { setTyped(null); onChange(clamp(round((now ?? min) - step), min, max)); }}>
        <Minus className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      <input type="number" inputMode={decimals ? 'decimal' : 'numeric'} min={min} max={max} step={decimals ? 1 / places : 1} aria-label={name} placeholder={empty} style={width ? { width } : undefined}
        value={typed ?? (now === null ? '' : String(now))}
        onBlur={() => setTyped(null)}
        onChange={(e) => {
          const text = e.target.value;
          if (text === '') {
            // A half-typed number reads as empty to the browser; leave it be.
            if (e.target.validity?.badInput) return;
            setTyped('');
            if (min <= 0) onChange(0);
            return;
          }
          const n = Number(text);
          if (!Number.isFinite(n)) return;
          const kept = clamp(round(n), min, max);
          setTyped(kept === n ? text : null);
          onChange(kept);
        }} />
      <button type="button" aria-label={t('admin.creator.stepper.more', { name })} disabled={now !== null && now >= max} onClick={() => { setTyped(null); onChange(clamp(now === null ? (start ?? min) : round(now + step), min, max)); }}>
        <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    </span>
  );
}

/** A settings row with the label on the left and a stepper on the right. */
export function StepperRow(props: { label: string } & Parameters<typeof Stepper>[0]) {
  const { label, ...stepper } = props;
  return (
    <div className="cw-row" style={{ minHeight: 64 }}>
      <span className="cw-grow cw-t1" style={{ fontSize: 16 }}>{label}</span>
      <Stepper {...stepper} />
    </div>
  );
}
