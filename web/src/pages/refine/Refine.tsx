import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Minus, Plus, X } from 'lucide-react';
import { TickerNumber } from '../../components/TickerNumber';
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
  /** A page-level action on the right of the title row (for example "End stream"). */
  titleAction?: ReactNode;
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

export function RefineHeader({ back, onBack, backLabel = 'Back', context, actions, title, titleAction, demo, subtitle, tabs, tabsLabel = 'Sections', tabsKind = 'nav', children }: HeaderProps) {
  const tabsRef = useRef<HTMLElement>(null);
  const [moreTabs, setMoreTabs] = useState(false);
  const activeTab = tabs?.findIndex((tab) => tab.active) ?? -1;
  // A long tab strip scrolls sideways on a phone: keep the open tab in view and fade the edge while more tabs are hidden.
  useEffect(() => {
    const nav = tabsRef.current;
    if (!nav) return;
    const active = nav.children[activeTab] as HTMLElement | undefined;
    if (active && (active.offsetLeft < nav.scrollLeft || active.offsetLeft + active.offsetWidth > nav.scrollLeft + nav.clientWidth)) {
      nav.scrollTo?.({ left: Math.max(0, active.offsetLeft - 24) });
    }
    const update = () => setMoreTabs(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
    update();
    nav.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { nav.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [activeTab]);
  return (
    <header className="rf-hd">
      <div className="rf-hd-top">
        {back && <Link className="rf-ib" to={back} aria-label={backLabel}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Link>}
        {!back && onBack && <button type="button" className="rf-ib" aria-label={backLabel} onClick={onBack}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>}
        <span className="rf-ctx">{context}</span>
        {actions}
      </div>
      {titleAction ? (
        <div className="rf-ttl-row">
          <h1 className="rf-ttl">{title}{demo && <DemoChip />}</h1>
          {titleAction}
        </div>
      ) : <h1 className="rf-ttl">{title}{demo && <DemoChip />}</h1>}
      {subtitle && <p className="rf-sub">{subtitle}</p>}
      {children}
      {tabs && tabs.length > 0 && (
        <nav ref={tabsRef} className={`rf-tabs ${moreTabs ? 'rf-tabs-more' : ''}`} aria-label={tabsLabel} role={tabsKind === 'tablist' ? 'tablist' : undefined} onKeyDown={tabsKind === 'tablist' ? moveTabFocus : undefined}>
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
      <output aria-live="polite"><TickerNumber value={value} format={String} /></output>
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

export interface ChoiceOption<T extends string> { value: T; label: string }

interface Place { top: number; right: number; max: number }

/** Where a floating panel goes: under the right end of the row it opens from. */
function placeUnder(element: HTMLElement | null): Place | null {
  const rect = element?.getBoundingClientRect();
  if (!rect) return null;
  return { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right + 12), max: Math.max(160, window.innerHeight - rect.bottom - 16) };
}

/** A small panel fixed under a row. It closes on Escape, on a click outside it and its row, and on resize. */
function FloatingPanel({ anchor, place, onClose, children }: { anchor: RefObject<HTMLElement | null>; place: Place; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) closeRef.current();
    };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') { closeRef.current(); anchor.current?.focus(); } };
    const resize = () => closeRef.current();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); window.removeEventListener('resize', resize); };
  }, [anchor]);
  return createPortal(<div ref={ref} className="skin rf-pop" style={{ top: place.top, right: place.right, maxHeight: place.max }}>{children}</div>, document.body);
}

/**
 * A settings row: the label on the left, the current choice on the right with a chevron. Tapping it opens a small list
 * under the right end of the row, on every screen size. `allowOther` adds "Other…", which swaps the list for a box to
 * type your own value in.
 */
export function RefineChoiceRow<T extends string>({ label, value, options, onChange, disabled = false, allowOther = false, placeholder = 'Choose' }: {
  label: string; value: T; options: ChoiceOption<T>[]; onChange: (value: T) => void; disabled?: boolean; allowOther?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [custom, setCustom] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const known = options.find((option) => option.value === value);
  const current = known?.label ?? (value || placeholder);

  const close = () => { setOpen(false); setTyping(false); };
  function toggle() {
    if (open) { close(); return; }
    setPlace(placeUnder(rowRef.current));
    setCustom('');
    setOpen(true);
  }
  const choose = (next: T) => { close(); if (next !== value) onChange(next); };
  const submitCustom = () => { const text = custom.trim(); if (text) choose(text as T); };

  const list = typing ? (
    <form className="rf-choice-other" onSubmit={(event) => { event.preventDefault(); submitCustom(); }}>
      <input autoFocus aria-label={`${label}, your own`} value={custom} onChange={(event) => setCustom(event.target.value)} maxLength={60} />
      <button type="submit" className="rf-btn" disabled={!custom.trim()}>Use</button>
    </form>
  ) : (
    <div role="listbox" aria-label={label} className="rf-choices">
      {options.map((option) => (
        <button key={option.value} type="button" role="option" aria-selected={option.value === value} className="rf-choice" onClick={() => choose(option.value)}>
          <span>{option.label}</span>{option.value === value && <Check className="h-4 w-4" aria-hidden="true" />}
        </button>
      ))}
      {allowOther && <button type="button" role="option" aria-selected={false} className="rf-choice" onClick={() => setTyping(true)}><span>Other…</span></button>}
    </div>
  );
  return (
    <div className="rf-choice-wrap">
      <button ref={rowRef} type="button" className="rf-row rf-choice-row" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${current}`} disabled={disabled} onClick={toggle}>
        <span className="rf-grow rf-t1">{label}</span>
        <span className={`rf-choice-val ${known || value ? '' : 'rf-choice-empty'}`}>{current}</span>
        <ChevronRight className="rf-chev h-4 w-4" aria-hidden="true" />
      </button>
      {open && place && <FloatingPanel anchor={rowRef} place={place} onClose={close}>{list}</FloatingPanel>}
    </div>
  );
}

const MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "Fri 23 Oct, 18:00" for an ISO time, in the device's zone. */
function dateTimeText(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * A settings row for a date and time: "Deadline … Fri 23 Oct, 18:00 ›". It opens a small panel with a month calendar
 * (the event's days ringed, the chosen day filled) and the phone's own time box. Done saves; Remove clears it.
 */
export function RefineDateTimeRow({ label, value, onChange, eventDays = [], removable = true, disabled = false }: {
  label: string; value: string | null; onChange: (iso: string | null) => void; eventDays?: Date[]; removable?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [day, setDay] = useState<Date | null>(null);
  const [time, setTime] = useState('09:00');
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const rowRef = useRef<HTMLButtonElement>(null);
  const text = dateTimeText(value);

  function begin() {
    if (open) { setOpen(false); return; }
    const current = value ? new Date(value) : null;
    const valid = current && !Number.isNaN(current.getTime()) ? current : null;
    setDay(valid ? startOfDay(valid) : null);
    setTime(valid ? `${pad2(valid.getHours())}:${pad2(valid.getMinutes())}` : '09:00');
    setMonth(startOfDay(valid ?? eventDays[0] ?? new Date()));
    setPlace(placeUnder(rowRef.current));
    setOpen(true);
  }
  function done() {
    if (!day || !/^\d{2}:\d{2}$/.test(time)) return;
    const [h, m] = time.split(':').map(Number);
    setOpen(false);
    onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString());
  }
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: total }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const shift = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  return (
    <div className="rf-choice-wrap">
      <button ref={rowRef} type="button" className="rf-row rf-choice-row" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${text || 'Not set'}`} disabled={disabled} onClick={begin}>
        <span className="rf-grow rf-t1">{label}</span>
        <span className={`rf-choice-val ${text ? '' : 'rf-choice-empty'}`}>{text || 'Not set'}</span>
        <ChevronRight className="rf-chev h-4 w-4" aria-hidden="true" />
      </button>
      {open && place && (
        <FloatingPanel anchor={rowRef} place={place} onClose={() => setOpen(false)}>
          <div role="dialog" aria-label={label} className="rf-cal">
            <div className="rf-cal-head">
              <button type="button" className="rf-ib" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
              <strong>{MONTH_FORMAT.format(month)}</strong>
              <button type="button" className="rf-ib" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
            </div>
            <div className="rf-cal-grid" role="grid" aria-label={MONTH_FORMAT.format(month)}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="rf-cal-dow" aria-hidden="true">{d}</span>)}
              {cells.map((cell, i) => cell ? (
                <button key={i} type="button" role="gridcell" aria-selected={day ? sameDay(cell, day) : false}
                  aria-label={cell.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                  className={`rf-cal-day ${eventDays.some((d) => sameDay(d, cell)) ? 'rf-cal-event' : ''}`} onClick={() => setDay(cell)}>{cell.getDate()}</button>
              ) : <span key={i} />)}
            </div>
            <label className="rf-cal-time">Time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
            <div className="rf-cal-actions">
              {removable && value ? <button type="button" className="rf-link-danger" onClick={() => { setOpen(false); onChange(null); }}>Remove</button> : <span />}
              <button type="button" className="rf-btn rf-btn-primary" disabled={!day || !time} onClick={done}>Done</button>
            </div>
          </div>
        </FloatingPanel>
      )}
    </div>
  );
}

/** A row with the label on the left and a small switch on the right. */
export function RefineSwitchRow({ label, on, onChange, disabled = false }: { label: string; on: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <div className="rf-row">
      <span className="rf-grow rf-t1">{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="rf-sw" onClick={() => onChange(!on)}><span aria-hidden="true" /></button>
    </div>
  );
}

export interface RefineMenuItem { label: string; onSelect: () => void; /** Shown as red underlined text, for removing things. */ danger?: boolean }

/** A small ⋯ button (or a pill with `text`) that opens a floating menu under it. Choosing an item closes the menu and runs it. */
export function RefineMenu({ label, items, disabled = false, text }: { label: string; items: RefineMenuItem[]; disabled?: boolean; text?: string }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  function toggle() {
    if (open) { setOpen(false); return; }
    setPlace(placeUnder(buttonRef.current));
    setOpen(true);
  }
  return (
    <>
      {text ? (
        <button ref={buttonRef} type="button" className="rf-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={toggle}>{text}</button>
      ) : (
        <button ref={buttonRef} type="button" className="ops-ibtn" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={toggle}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {open && place && (
        <FloatingPanel anchor={buttonRef} place={place} onClose={() => setOpen(false)}>
          <div role="menu" aria-label={label} className="rf-choices">
            {items.map((item) => (
              <button key={item.label} type="button" role="menuitem" className={`rf-choice ${item.danger ? 'rf-menu-danger' : ''}`.trim()} onClick={() => { setOpen(false); item.onSelect(); }}>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </FloatingPanel>
      )}
    </>
  );
}
