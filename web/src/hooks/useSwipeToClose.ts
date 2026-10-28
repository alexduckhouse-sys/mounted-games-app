import { useRef, useState, type CSSProperties, type PointerEvent, type TouchEvent } from 'react';

/** A drag this far down always closes, whatever the pop-up's height. */
const CLOSE_MIN_PX = 48;
/** A drag past this share of the pop-up's height closes it. */
const CLOSE_SHARE = 0.25;
/** A flick: a short, quick drag down (px per ms) closes it too. */
const FLICK_SPEED = 0.5;
const FLICK_MIN_PX = 12;

interface Drag { startY: number; startAt: number; lastY: number; lastAt: number }

/**
 * Swipe a bottom pop-up down to close it. While the finger is down the pop-up follows it 1:1; let go past a quarter of
 * its height (or after a quick flick) and `onClose` runs with the pop-up still where the finger left it (`--drag`, so
 * the leave animation starts from there); let go short of that and it slides back. A drag that starts in a field,
 * button or link, or while the pop-up is scrolled, is someone typing, tapping or scrolling, so it is left alone.
 */
export function useSwipeToClose<T extends HTMLElement>(onClose: () => void, enabled = true) {
  const ref = useRef<T>(null);
  const drag = useRef<Drag | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [released, setReleased] = useState(false);

  function begin(y: number, target: EventTarget | null) {
    if (!enabled || released || (ref.current?.scrollTop ?? 0) > 0) return;
    // From 640px wide these are centred cards, not sheets, so there is nothing to pull down.
    if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 640px)').matches) return;
    if (target instanceof Element && target.closest('input, textarea, select, button, a, [data-no-swipe]')) return;
    const now = performance.now();
    drag.current = { startY: y, startAt: now, lastY: y, lastAt: now };
  }
  function move(y: number) {
    const current = drag.current;
    if (!current) return;
    const distance = Math.max(0, y - current.startY);
    current.lastY = y;
    current.lastAt = performance.now();
    if (distance > 0) setDragging(true);
    setDragY(distance);
  }
  function cancel() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setDragY(0);
  }
  function end(y?: number) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    const lastY = y ?? current.lastY;
    const distance = Math.max(0, lastY - current.startY);
    const speed = distance / Math.max(1, performance.now() - current.startAt);
    const height = ref.current?.getBoundingClientRect().height ?? 0;
    setDragging(false);
    if (distance >= Math.max(CLOSE_MIN_PX, height * CLOSE_SHARE) || (distance >= FLICK_MIN_PX && speed >= FLICK_SPEED)) {
      setDragY(distance);
      setReleased(true);
      onClose();
    } else {
      setDragY(0);
    }
  }

  const handlers = {
    onTouchStart: (event: TouchEvent) => begin(event.touches[0].clientY, event.target),
    onTouchMove: (event: TouchEvent) => move(event.touches[0].clientY),
    onTouchEnd: (event: TouchEvent) => end(event.changedTouches[0]?.clientY),
    onTouchCancel: cancel,
    onPointerDown: (event: PointerEvent) => { if (event.button === 0) begin(event.clientY, event.target); },
    onPointerMove: (event: PointerEvent) => { if (event.buttons === 0 && event.pointerType === 'mouse') { cancel(); return; } move(event.clientY); },
    onPointerUp: (event: PointerEvent) => end(event.clientY),
    onPointerCancel: cancel,
  };
  const style = dragY > 0 ? ({ transform: `translateY(${dragY}px)`, '--drag': `${dragY}px` } as CSSProperties) : undefined;
  return { ref, handlers, style, dragging };
}
