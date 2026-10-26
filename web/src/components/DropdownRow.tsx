import { ChevronRight } from 'lucide-react';
import { Dropdown, type DropdownOption } from './Dropdown';

/**
 * A settings row for a choice: the label on the left, the current choice and a chevron on the right. Tapping it
 * opens the small floating list under the row (above it when there is no room), on phones too. Arrow keys, Enter,
 * Escape and typing work as in `Dropdown`, and focus stays on the row.
 */
export function DropdownRow({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value)?.label ?? '';
  return (
    <Dropdown
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      className="rounded-[var(--mg-radius-card)] border border-[rgb(var(--mg-line))] bg-[rgb(var(--mg-surface))] shadow-[var(--mg-shadow-sm)]"
      buttonClassName="flex min-h-14 w-full items-center gap-3 rounded-[var(--mg-radius-card)] px-4 text-left"
    >
      <span className="flex-1 text-base font-semibold text-[rgb(var(--mg-ink))]">{label}</span>
      <span className="text-[15px] font-semibold text-[rgb(var(--mg-heading))]">{current}</span>
      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))]" strokeWidth={2.5} />
    </Dropdown>
  );
}
