import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
  /** Small extra text after the label, such as a team count. */
  hint?: string;
  /** Shows a red "on now" dot beside the label. */
  live?: boolean;
}

/**
 * A menu that opens under its button. The button keeps focus; arrows move through the options, Enter or Space
 * picks one, Escape or a tap outside closes it. `children` is what the button shows.
 */
export function Dropdown({ label, value, options, onChange, className, buttonClassName, children }: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  className?: string;
  buttonClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const show = () => { setActive(Math.max(0, options.findIndex((option) => option.value === value))); setOpen(true); };
  const pick = (index: number) => { setOpen(false); if (options[index] && options[index].value !== value) onChange(options[index].value); };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const move = (to: number) => { event.preventDefault(); if (open) setActive(Math.min(options.length - 1, Math.max(0, to))); else show(); };
    if (event.key === 'ArrowDown') move(active + 1);
    else if (event.key === 'ArrowUp') move(active - 1);
    else if (event.key === 'Home' && open) move(0);
    else if (event.key === 'End' && open) move(options.length - 1);
    else if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); }
    else if (event.key === 'Tab') setOpen(false);
    else if ((event.key === 'Enter' || event.key === ' ') && open) { event.preventDefault(); pick(active); }
  };

  return (
    <div ref={root} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        className={buttonClassName}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {children}
      </button>
      {open && (
        <ul ref={menu} id={id} role="listbox" aria-label={label} className="mg-dropdown-menu">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={option.value === value}
              data-active={index === active || undefined}
              className="mg-dropdown-option"
              onPointerEnter={() => setActive(index)}
              onClick={() => pick(index)}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.hint && <span className="shrink-0 text-xs font-medium text-[rgb(var(--mg-muted))]">{option.hint}</span>}
              {option.live && <span className="shrink-0 text-[10px] font-bold tracking-[0.06em] text-[rgb(var(--mg-red))]">ON NOW</span>}
              {option.value === value && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
