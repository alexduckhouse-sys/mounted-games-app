import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { dropIndex, makeRoom } from '../lib/creatorRaces';

interface Drag { group: string; from: number; to: number; dy: number; height: number }

/**
 * Putting rows in order: drag a row's six-dot grip, or press the up and down arrow keys while the grip has focus.
 * Give each row `data-race-row`, `data-lifted={lifted(i)}` and `style={rowStyle(i)}`, wrap the rows in an element with
 * `data-row-list`, and put `grab`/`keys` on a {@link GripButton}. `onMove(from, to)` is called once the row has landed.
 */
export function useRowDrag() {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  function grab(e: ReactPointerEvent<HTMLElement>, index: number, length: number, onMove: (from: number, to: number) => void, group = '') {
    if (e.button > 0) return;
    e.preventDefault();
    const row = e.currentTarget.closest('[data-race-row]');
    const height = row ? row.getBoundingClientRect().height : 56;
    const y0 = e.clientY;
    const start: Drag = { group, from: index, to: index, dy: 0, height };
    dragRef.current = start;
    setDrag(start);
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      const next = { ...start, dy, to: dropIndex(index, dy, height, length) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const done = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (done && done.to !== done.from) onMove(done.from, done.to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function keys(e: ReactKeyboardEvent<HTMLElement>, index: number, length: number, onMove: (from: number, to: number) => void) {
    const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!by || index + by < 0 || index + by >= length) return;
    e.preventDefault();
    const grip = e.currentTarget;
    const list = grip.closest('[data-row-list]');
    onMove(index, index + by);
    // Rows keyed by position keep the same grip at the same place, so focus has to follow the row to its new one.
    // Rows with their own keys already carry their grip along.
    requestAnimationFrame(() => {
      const grips = list?.querySelectorAll<HTMLElement>('[data-row-grip]');
      if (grips?.[index] === grip) grips[index + by]?.focus();
    });
  }

  // `group` tells lists apart when several share one hook; rows of another list stay still.
  const lifted = (index: number, group = '') => drag?.group === group && drag.from === index;
  const rowStyle = (index: number, group = '') => {
    if (!drag || drag.group !== group) return undefined;
    if (index === drag.from) return { transform: `translateY(${drag.dy}px)` };
    const shift = makeRoom(index, drag.from, drag.to, drag.height);
    return shift ? { transform: `translateY(${shift}px)` } : undefined;
  };
  return { grab, keys, lifted, rowStyle };
}
