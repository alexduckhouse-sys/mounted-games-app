import type { KeyboardEventHandler, PointerEventHandler } from 'react';
import './rowDrag.css';

/** Six dots: the grip for dragging a row into a new place. */
export function GripIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" />
    </svg>
  );
}

/** The grip button of a draggable row: pointer to drag, ArrowUp and ArrowDown to move while it has focus. */
export function GripButton({ label, onPointerDown, onKeyDown }: {
  label: string;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
}) {
  return (
    <button type="button" data-row-grip="" className="mg-grip" aria-label={label} onPointerDown={onPointerDown} onKeyDown={onKeyDown}><GripIcon /></button>
  );
}
