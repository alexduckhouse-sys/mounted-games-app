import { useEffect, useId, type ReactNode } from 'react';
import { useExitDelay } from '../hooks/useExitDelay';
import { useSwipeToClose } from '../hooks/useSwipeToClose';

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
  const titleId = useId();
  const descriptionId = useId();
  const { closing, close } = useExitDelay((after?: () => void) => (after ?? onClose)());
  const { ref, handlers, style, dragging } = useSwipeToClose<HTMLDialogElement>(() => close(), dismissible);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => { if (typeof dialog.close === 'function') dialog.close(); };
  }, [initialFocus, ref]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); if (dismissible) close(); }}
      onClick={(event) => { if (dismissible && event.target === event.currentTarget) close(); }}
      {...handlers}
      style={style}
      className={`mg-sheet kit-sheet${dragging ? ' is-dragging' : ''}${closing ? ' is-closing' : ''} ${className}`.trim()}
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
