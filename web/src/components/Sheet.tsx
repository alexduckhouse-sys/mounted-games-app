import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useExitDelay } from '../hooks/useExitDelay';

const SWIPE_DISMISS_PX = 48;

export interface SheetProps {
  /** The heading: a short question or name, in Barlow Condensed. */
  title: ReactNode;
  /** Called after the sheet has slid away: on Escape, a swipe down, or a tap on the dim behind it. */
  onClose: () => void;
  /** One short paragraph under the heading; it is also what screen readers hear as the description. */
  description?: ReactNode;
  /** Set to false for a sheet that must be answered with its own buttons (Escape and swipes do nothing). */
  dismissible?: boolean;
  /** CSS selector inside the sheet to focus first. Left out, the browser focuses the first control. */
  initialFocus?: string;
  /** Extra classes on the dialog, for a sheet that needs its own width or height. */
  className?: string;
  /** The body. Pass a function to get `close(after?)`: it slides the sheet away, then calls `after` (or `onClose`). */
  children: ReactNode | ((sheet: { close: (after?: () => void) => void }) => ReactNode);
}

/**
 * The bottom sheet every question and every list of details uses: a squircle sheet with a handle and a Barlow
 * Condensed heading on phones, a centred card on wider screens. Pills go in `<div className="kit-acts">`
 * (go-ahead, filled `kit-pill kit-pill-fill` first) or `<div className="kit-acts-del">` (delete type: Cancel then
 * `kit-pill kit-pill-del`). Dropdowns are not sheets.
 */
export function Sheet({ title, description, onClose, dismissible = true, initialFocus, className = '', children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const titleId = useId();
  const descriptionId = useId();
  const { closing, close } = useExitDelay((after?: () => void) => (after ?? onClose)());

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => { if (typeof dialog.close === 'function') dialog.close(); };
  }, [initialFocus]);

  // A drag that starts in a field, button/link, or on a scrolled sheet, is the person typing, tapping or scrolling, not closing.
  function begin(y: number, target: EventTarget | null) {
    if (!dismissible || (ref.current?.scrollTop ?? 0) !== 0) return;
    if (target instanceof Element && target.closest('input, textarea, select, button, a, [data-no-swipe]')) return;
    startY.current = y;
  }
  function move(y: number) {
    if (startY.current === null) return;
    setDragY(Math.max(0, y - startY.current));
  }
  function cancel() {
    if (startY.current === null) return;
    startY.current = null;
    setDragY(0);
  }
  function end(y?: number) {
    if (startY.current === null) return;
    const distance = Math.max(dragY, (y ?? startY.current) - startY.current);
    startY.current = null;
    setDragY(0);
    if (distance >= SWIPE_DISMISS_PX) close();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); if (dismissible) close(); }}
      onClick={(event) => { if (dismissible && event.target === event.currentTarget) close(); }}
      onTouchStart={(event) => begin(event.touches[0].clientY, event.target)}
      onTouchMove={(event) => move(event.touches[0].clientY)}
      onTouchEnd={(event) => end(event.changedTouches[0]?.clientY)}
      onTouchCancel={cancel}
      onPointerDown={(event) => { if (event.button === 0) begin(event.clientY, event.target); }}
      onPointerMove={(event) => { if (event.buttons === 0 && event.pointerType === 'mouse') { cancel(); return; } move(event.clientY); }}
      onPointerUp={(event) => end(event.clientY)}
      onPointerCancel={cancel}
      style={dragY > 0 ? { transform: `translateY(${dragY}px)`, '--drag': `${dragY}px` } as CSSProperties : undefined}
      className={`mg-sheet kit-sheet${closing ? ' is-closing' : ''} ${className}`.trim()}
    >
      <div className="kit-sheet-inner">
        <span aria-hidden="true" className="kit-sheet-grip" />
        <h2 id={titleId} className="kit-sheet-title">{title}</h2>
        {description && <p id={descriptionId} className="kit-sheet-text">{description}</p>}
        {typeof children === 'function' ? children({ close }) : children}
      </div>
    </dialog>
  );
}
