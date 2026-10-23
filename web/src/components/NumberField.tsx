import type { ChangeEvent, ClipboardEvent, InputHTMLAttributes, KeyboardEvent } from 'react';

export interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> {
  /** Allow a decimal point (money, times). Whole numbers only otherwise. */
  decimal?: boolean;
  /** Allow a minus sign. Also on when `min` is below zero. */
  allowNegative?: boolean;
}

/** Whether `text` is a number being typed: digits, with a point and a leading minus only where allowed. */
function isNumberText(text: string, decimal: boolean, negative: boolean): boolean {
  const pattern = decimal ? (negative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/) : (negative ? /^-?\d*$/ : /^\d*$/);
  return pattern.test(text);
}

/**
 * A number box that only accepts digits. A plain `type="number"` also lets people type `e`, `+` and `-`
 * (and "1e5" is a valid number), so this blocks them on key press, paste and change. It keeps `min`, `max`,
 * `step` and the steppers, and the value is still the string the browser gives.
 */
export function NumberField({ decimal = false, allowNegative, min, onKeyDown, onPaste, onChange, ...rest }: NumberFieldProps) {
  const negative = allowNegative ?? (min != null && Number(min) < 0);

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    const allowed = /\d/.test(event.key) || (decimal && event.key === '.') || (negative && event.key === '-');
    if (!allowed) event.preventDefault();
  };

  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    const text = event.clipboardData.getData('text').trim();
    if (!isNumberText(text, decimal, negative)) event.preventDefault();
  };

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    // Drawn in by other routes (IME, autofill, drag and drop): a value that isn't plain digits is dropped.
    const input = event.target;
    if (input.validity.badInput || !isNumberText(input.value, decimal, negative)) return;
    onChange?.(event);
  };

  return <input {...rest} min={min} type="number" inputMode={decimal ? 'decimal' : 'numeric'} onKeyDown={keyDown} onPaste={paste} onChange={change} />;
}
