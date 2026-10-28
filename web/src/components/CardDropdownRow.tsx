import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Dropdown, type DropdownOption } from './Dropdown';
import './sitePages.css';

/**
 * A settings row: the label on the left, the current choice and a chevron on the right. Tapping it opens a small
 * floating list under the row (see `Dropdown`). Put it inside a `.sp-card`, which lets the list open past the card.
 * `swatch` shows a colour square before the choice, for the theme picker.
 */
export function CardDropdownRow({ label, value, options, onChange, disabled, swatch, hint }: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** A CSS background for the small colour square shown before the current choice. */
  swatch?: (value: string) => string | undefined;
  /** A line under the label. */
  hint?: ReactNode;
}) {
  const id = useId();
  const current = options.find((option) => option.value === value)?.label ?? value;
  const colour = swatch?.(value);
  return (
    <Dropdown
      labelledBy={`${id}-label ${id}-value`}
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      className="sp-dropdown block w-full"
      buttonClassName="sp-row w-full"
      menuClassName="sp-menu"
    >
      <span className="sp-grow"><span id={`${id}-label`} className="sp-t1">{label}</span>{hint != null && <span className="sp-t2">{hint}</span>}</span>
      <span className="sp-val">
        {colour && <span aria-hidden="true" className="sp-swatch" style={{ background: colour }} />}
        <span id={`${id}-value`}>{current}</span>
        {!disabled && <ChevronRight aria-hidden="true" className="sp-chev h-4 w-4" strokeWidth={2.5} />}
      </span>
    </Dropdown>
  );
}
