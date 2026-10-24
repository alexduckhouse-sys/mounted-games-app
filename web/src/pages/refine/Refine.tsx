import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import { usePageWidth } from '../../components/pageWidthState';
import './refine.css';

/** Wraps a refined page so its tokens and type apply. Pass `aboveTabs` on competition pages that show the bottom tabs. */
export function RefinePage({ children, className = '', wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  // `wide` pages lay themselves out in columns on a laptop, so they take the room the shell allows.
  usePageWidth(wide ? 'wide' : 'default');
  return <div className={`skin rf-page mx-auto w-full max-w-3xl ${wide ? 'lg:max-w-none' : ''} ${className}`.trim()}>{children}</div>;
}

export interface RefineTab { label: string; to?: string; active: boolean; onSelect?: () => void }

interface HeaderProps {
  /** Link target for the back arrow; omit for top-level screens. */
  back?: string;
  /** Use instead of `back` when going back is an in-page step rather than a route. */
  onBack?: () => void;
  backLabel?: string;
  context: string;
  /** Trailing controls in the top row (an overflow button, a star, "+ Add item"). */
  actions?: ReactNode;
  title: string;
  /** Shows the yellow DEMO chip beside the title. */
  demo?: boolean;
  subtitle?: ReactNode;
  tabs?: RefineTab[];
  tabsLabel?: string;
  /** `nav` tabs link to routes (aria-current); `tablist` tabs filter in place (role="tab"). */
  tabsKind?: 'nav' | 'tablist';
  children?: ReactNode;
}

/** Arrow, Home and End move between role="tab" buttons and select the one they land on. */
function moveTabFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  if (current < 0) return;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

export function RefineHeader({ back, onBack, backLabel = 'Back', context, actions, title, demo, subtitle, tabs, tabsLabel = 'Sections', tabsKind = 'nav', children }: HeaderProps) {
  return (
    <header className="rf-hd">
      <div className="rf-hd-top">
        {back && <Link className="rf-ib" to={back} aria-label={backLabel}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Link>}
        {!back && onBack && <button type="button" className="rf-ib" aria-label={backLabel} onClick={onBack}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>}
        <span className="rf-ctx">{context}</span>
        {actions}
      </div>
      <h1 className="rf-ttl">{title}{demo && <DemoChip />}</h1>
      {subtitle && <p className="rf-sub">{subtitle}</p>}
      {children}
      {tabs && tabs.length > 0 && (
        <nav className="rf-tabs" aria-label={tabsLabel} role={tabsKind === 'tablist' ? 'tablist' : undefined} onKeyDown={tabsKind === 'tablist' ? moveTabFocus : undefined}>
          {tabs.map((tab) => tabsKind === 'tablist' ? (
            <button key={tab.label} type="button" role="tab" aria-selected={tab.active} tabIndex={tab.active ? 0 : -1} className="rf-tab" onClick={tab.onSelect}>{tab.label}</button>
          ) : tab.to ? (
            <Link key={tab.label} to={tab.to} className="rf-tab" aria-current={tab.active ? 'page' : undefined}>{tab.label}</Link>
          ) : (
            <button key={tab.label} type="button" className="rf-tab" aria-current={tab.active ? 'page' : undefined} onClick={tab.onSelect}>{tab.label}</button>
          ))}
        </nav>
      )}
    </header>
  );
}

export function DemoChip() {
  return <span className="rf-demo">DEMO</span>;
}

export function RefineSection({ title, meta }: { title: string; meta?: ReactNode }) {
  return <h2 className="rf-sec">{title}{meta != null && <span>{meta}</span>}</h2>;
}

export function RefineList({ children, as: Tag = 'ul', label }: { children: ReactNode; as?: 'ul' | 'ol' | 'div'; label?: string }) {
  return <Tag className="rf-list" aria-label={label}>{children}</Tag>;
}

export function RefineNote({ children }: { children: ReactNode }) {
  return <p className="rf-note">{children}</p>;
}

export type StatusTone = 'ok' | 'warn' | 'bad' | 'mut' | 'live';
/** Status as coloured text. The word always carries the meaning; colour only reinforces it. */
export function RefineStatus({ tone = 'mut', children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={`rf-st rf-${tone}`}>{children}</span>;
}

export function Chevron({ down = false }: { down?: boolean }) {
  return down
    ? <ChevronDown className={`rf-chev rf-chev-down h-4 w-4`} aria-hidden="true" />
    : <ChevronRight className="rf-chev h-4 w-4" aria-hidden="true" />;
}

/** A collapsible row: a `<details>` whose summary is a list row. Children appear below it. */
export function RefineDisclosure({ title, sub, trailing, defaultOpen = false, children }: { title: ReactNode; sub?: ReactNode; trailing?: ReactNode; defaultOpen?: boolean; children?: ReactNode }) {
  return (
    <details open={defaultOpen}>
      <summary className="rf-row">
        <span className="rf-grow"><span className="rf-t1">{title}</span>{sub != null && <span className="rf-t2">{sub}</span>}</span>
        {trailing}
        <Chevron down />
      </summary>
      {children}
    </details>
  );
}

interface QtyProps { name: string; value: number; onChange: (next: number) => void; max?: number; disabled?: boolean }
export function RefineQty({ name, value, onChange, max = 99, disabled = false }: QtyProps) {
  return (
    <span className="rf-qty" role="group" aria-label={`Quantity for ${name}`}>
      <button type="button" aria-label={`Remove one ${name}`} disabled={disabled || value <= 0} onClick={() => onChange(value - 1)}><Minus className="h-4 w-4" aria-hidden="true" /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={`Add one ${name}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}><Plus className="h-4 w-4" aria-hidden="true" /></button>
    </span>
  );
}

/** The screen's one primary action, sticky under the content. `aboveTabs` lifts it over a competition's bottom tabs. */
export function RefineFoot({ children, column = false, aboveTabs = false, label }: { children: ReactNode; column?: boolean; aboveTabs?: boolean; label?: string }) {
  return <div className={`rf-foot ${column ? 'rf-foot-col' : ''} ${aboveTabs ? 'rf-above-tabs' : ''}`.trim()} role={label ? 'region' : undefined} aria-label={label}>{children}</div>;
}

interface SheetProps { title: string; onClose: () => void; children: ReactNode }

/** Modal bottom sheet: traps focus, closes on Esc, the scrim or the × button, and returns focus to whatever opened it. */
export function RefineSheet({ title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = ref.current;
    const focusables = () => [...(sheet?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href]') ?? [])];
    (focusables().find((el) => el.tagName === 'INPUT' || el.tagName === 'SELECT') ?? focusables()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      // Focus can fall out of the sheet (a button disabled or removed); pull it back in.
      if (!sheet?.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus(); };
  }, []);
  return (
    <>
      <div className="rf-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="rf-sheet skin">
        <span className="rf-grab" aria-hidden="true" />
        <div className="rf-sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="rf-ib" aria-label="Close" onClick={onClose}><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </>
  );
}
