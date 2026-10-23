import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

/** A part of a laptop page: a navy rule with the title in Barlow Condensed capitals, and anything small on the right. */
export function PartHead({ id, title, meta, alert }: { id: string; title: string; meta?: ReactNode; alert?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 border-b-2 border-[rgb(var(--mg-heading))] pb-2">
      <h2 id={id} className="mg-display flex-1 text-[22px] font-bold uppercase leading-none tracking-[0.03em] text-[rgb(var(--mg-heading))]">{title}</h2>
      {meta != null && <span className={`text-[13px] leading-none ${alert ? 'font-bold text-[rgb(var(--mg-elim))]' : 'font-medium text-[rgb(var(--mg-muted))]'}`}>{meta}</span>}
    </div>
  );
}

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean }

/** The ••• button: opens a short list of actions under it. Escape or a tap outside closes it. */
export function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}
        className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[rgb(var(--mg-control))] text-[rgb(var(--mg-heading))] hover:border-[rgb(var(--mg-heading))]">
        <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      {open && (
        <ul id={id} role="menu" aria-label={label} className="absolute right-0 top-[calc(100%+4px)] z-30 m-0 min-w-52 list-none rounded-[10px] border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] p-1 shadow-[0_8px_24px_rgb(0_0_0/0.22)]">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button type="button" role="menuitem" onClick={() => { setOpen(false); item.onSelect(); }}
                className={`flex min-h-11 w-full items-center rounded-[7px] px-3 text-left text-[15px] font-semibold hover:bg-[rgb(var(--mg-subtle))] ${item.danger ? 'text-[rgb(var(--mg-elim))]' : 'text-[rgb(var(--mg-ink))]'}`}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
