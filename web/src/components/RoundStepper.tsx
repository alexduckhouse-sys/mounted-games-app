import { Minus, Plus } from 'lucide-react';
import './sitePages.css';

/**
 * Small round minus and plus buttons with the number between them, for counts such as stables or items in an order.
 * `name` makes the button labels ("Remove one Weekend camping", "Add one Weekend camping"); `addLabel` and
 * `removeLabel` replace them when a sentence reads better.
 */
export function RoundStepper({ name, value, onChange, min = 0, max = 99, disabled = false, addLabel, removeLabel }: {
  name: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  addLabel?: string;
  removeLabel?: string;
}) {
  return (
    <span className="sp-stepper" role="group" aria-label={`Quantity for ${name}`}>
      <button type="button" aria-label={removeLabel ?? `Remove one ${name}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <output aria-live="polite" className="!min-w-[30px]">{value}</output>
      <button type="button" aria-label={addLabel ?? `Add one ${name}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </span>
  );
}
