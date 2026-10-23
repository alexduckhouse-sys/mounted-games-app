import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
  /** Small extra text after the label, such as a team count. */
  hint?: string;
  /** Shows a red "on now" dot beside the label. */
  live?: boolean;
  /** Shown but can't be picked. */
  disabled?: boolean;
  /** A section heading shown above the first option of each group. */
  group?: string;
}

const MENU_MAX = 352;
const TYPE_AHEAD_MS = 700;

/**
 * A menu that opens under its button. The button keeps focus; arrows move through the options, Enter or Space
 * picks one, Escape or a tap outside closes it, and typing letters jumps to a matching option. The menu flips
 * above the button when there is more room there. `children` is what the button shows.
 */
export function Dropdown({
  label, labelledBy, id: buttonId, value, options, onChange, className, buttonClassName, menuClassName,
  disabled, invalid, title, children,
}: {
  /** Accessible name. Leave out when a wrapping label or `labelledBy` names the button. */
  label?: string;
  labelledBy?: string;
  id?: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
  invalid?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ up: boolean; max?: number }>({ up: false });
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  // Choose above or below, and keep the menu inside the screen.
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const wanted = Math.min(MENU_MAX, menu.current?.scrollHeight ?? MENU_MAX);
    const up = wanted > below && above > below;
    const room = up ? above : below;
    setPlace({ up, max: room > 80 ? Math.min(MENU_MAX, room) : undefined });
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector(`[id="${id}-${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);

  const enabled = (index: number) => !!options[index] && !options[index].disabled;
  const step = (from: number, by: 1 | -1) => {
    for (let i = from + by; i >= 0 && i < options.length; i += by) if (enabled(i)) return i;
    return from;
  };
  const first = () => { const i = options.findIndex((_, index) => enabled(index)); return i < 0 ? 0 : i; };
  const last = () => { for (let i = options.length - 1; i >= 0; i--) if (enabled(i)) return i; return 0; };

  const show = () => {
    const at = options.findIndex((option) => option.value === value);
    setActive(at >= 0 ? at : first());
    setPlace({ up: false });
    setOpen(true);
  };
  const pick = (index: number) => {
    if (!enabled(index)) return;
    setOpen(false);
    if (options[index].value !== value) onChange(options[index].value);
  };

  const typeAhead = (key: string) => {
    const now = Date.now();
    const text = (now - typed.current.at > TYPE_AHEAD_MS ? '' : typed.current.text) + key.toLowerCase();
    typed.current = { text, at: now };
    const from = open ? active : options.findIndex((option) => option.value === value);
    const search = (needle: string, start: number) => {
      for (let offset = 0; offset < options.length; offset++) {
        const index = (start + offset + options.length) % options.length;
        if (enabled(index) && options[index].label.toLowerCase().startsWith(needle)) return index;
      }
      return -1;
    };
    // Repeating one letter cycles through the options that start with it.
    const repeated = text.length > 1 && [...text].every((char) => char === text[0]);
    const hit = repeated ? search(text[0], from + 1) : search(text, from < 0 ? 0 : from);
    if (hit < 0) return;
    setActive(hit);
    if (!open) setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const move = (to: number) => { event.preventDefault(); if (open) setActive(to); else show(); };
    if (event.key === 'ArrowDown') move(step(active, 1));
    else if (event.key === 'ArrowUp') move(step(active, -1));
    else if (event.key === 'Home' && open) move(first());
    else if (event.key === 'End' && open) move(last());
    else if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); }
    else if (event.key === 'Tab') setOpen(false);
    else if ((event.key === 'Enter' || event.key === ' ') && open) { event.preventDefault(); pick(active); }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.preventDefault();
      typeAhead(event.key);
    }
  };

  let lastGroup: string | undefined;
  return (
    <div ref={root} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        id={buttonId}
        role="combobox"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-invalid={invalid || undefined}
        data-value={value}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        title={title}
        className={buttonClassName}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {children}
      </button>
      {open && (
        <ul
          ref={menu}
          id={id}
          role="listbox"
          aria-label={label}
          aria-labelledby={label ? undefined : labelledBy}
          className={`mg-dropdown-menu ${place.up ? 'mg-dropdown-up' : ''} ${menuClassName ?? ''}`}
          style={place.max ? { maxHeight: place.max } : undefined}
        >
          {options.map((option, index) => {
            const heading = option.group && option.group !== lastGroup ? option.group : null;
            lastGroup = option.group;
            return [
              heading && <li key={`g-${heading}-${index}`} role="presentation" className="mg-dropdown-group">{heading}</li>,
              <li
                key={`${option.value}-${index}`}
                id={`${id}-${index}`}
                role="option"
                aria-selected={option.value === value}
                data-value={option.value}
                aria-disabled={option.disabled || undefined}
                data-active={index === active || undefined}
                className="mg-dropdown-option"
                onPointerEnter={() => { if (!option.disabled) setActive(index); }}
                onClick={() => pick(index)}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && <span className="shrink-0 text-xs font-medium text-[rgb(var(--mg-muted))]">{option.hint}</span>}
                {option.live && <span className="shrink-0 text-[10px] font-bold tracking-[0.06em] text-[rgb(var(--mg-red))]">ON NOW</span>}
                {option.value === value && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </li>,
            ];
          })}
        </ul>
      )}
    </div>
  );
}
