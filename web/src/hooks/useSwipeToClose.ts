import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

/** A drag this far down always closes, whatever the pop-up's height. */
const CLOSE_MIN_PX = 48;
/** A drag past this share of the pop-up's height closes it. */
const CLOSE_SHARE = 0.25;
/** A flick: a short, quick drag down (px per ms) closes it too. */
const FLICK_SPEED = 0.5;
const FLICK_MIN_PX = 12;
/** A finger has to move this far before we decide whether it is a drag, a scroll or a tap. */
const SLOP_PX = 6;
/** The slide back after a short pull; the same curve the sheets slide in on (skin.css `--mg-sheet-ease`). */
const SETTLE_MS = 220;
const SETTLE = `transform ${SETTLE_MS}ms cubic-bezier(.32, .72, 0, 1)`;

interface Gesture {
  startX: number;
  startY: number;
  startAt: number;
  lastY: number;
  target: EventTarget | null;
  active: boolean;
  height: number;
}

/** True when the thing under the finger, or anything between it and the pop-up, is scrolled down: that finger is scrolling. */
function scrolledDown(target: EventTarget | null, root: HTMLElement | null) {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node.scrollTop > 0) return true;
    if (node === root) return false;
  }
  return (root?.scrollTop ?? 0) > 0;
}

/**
 * Swipe a bottom pop-up down to close it. While the finger is down the pop-up follows it 1:1; let go past a quarter of
 * its height (or after a quick flick) and `onClose` runs with the pop-up still where the finger left it (`--drag`, so
 * the leave animation starts from there); let go short of that and it eases back.
 *
 * A drag only starts when the finger moves down from a spot where nothing under it is scrolled (so a long list inside
 * the pop-up still scrolls), and not from a field, button or link. The pop-up is moved straight on the element, not
 * through React state, so a drag costs no renders. Touch uses native listeners (so the page behind doesn't scroll
 * or claim the gesture); a mouse or pen uses the pointer `handlers`, which you spread on the same element.
 */
export function useSwipeToClose<T extends HTMLElement>(onClose: () => void, enabled = true) {
  const ref = useRef<T>(null);
  const gesture = useRef<Gesture | null>(null);
  const released = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ onClose, enabled });
  useEffect(() => { latest.current = { onClose, enabled }; });

  function clearSettle() {
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
  }

  function start(x: number, y: number, target: EventTarget | null) {
    const element = ref.current;
    if (!latest.current.enabled || released.current || !element) return;
    // From 640px wide these are centred cards, not sheets, so there is nothing to pull down.
    if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 640px)').matches) return;
    if (target instanceof Element && target.closest('input, textarea, select, button, a, [data-no-swipe]')) return;
    clearSettle();
    gesture.current = { startX: x, startY: y, startAt: performance.now(), lastY: y, target, active: false, height: 0 };
  }

  /** Returns true once the finger is dragging the pop-up (so the caller can stop the page scrolling). */
  function track(x: number, y: number) {
    const current = gesture.current;
    const element = ref.current;
    if (!current || !element) return false;
    if (!current.active) {
      const dx = x - current.startX;
      const dy = y - current.startY;
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return false;
      // Up, sideways, or from a scrolled list: not ours. Let the browser have it.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || scrolledDown(current.target, element)) { gesture.current = null; return false; }
      current.active = true;
      current.height = element.getBoundingClientRect().height || 400;
      element.style.transition = 'none';
      setDragging(true);
    }
    current.lastY = y;
    const distance = Math.max(0, y - current.startY);
    element.style.transform = `translateY(${distance}px)`;
    element.style.setProperty('--drag', `${distance}px`);
    // `--fade` (1 down to 0) lets the dim behind the pop-up lighten as it is pulled away.
    element.style.setProperty('--fade', Math.max(0, 1 - distance / current.height).toFixed(3));
    return true;
  }

  function settleBack(element: HTMLElement) {
    element.style.transition = SETTLE;
    element.style.transform = '';
    element.style.setProperty('--fade', '1');
    clearSettle();
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      element.style.removeProperty('transition');
      element.style.removeProperty('--drag');
      element.style.removeProperty('--fade');
    }, SETTLE_MS + 40);
  }

  function end(y?: number) {
    const current = gesture.current;
    gesture.current = null;
    const element = ref.current;
    if (!current?.active || !element) return;
    setDragging(false);
    const distance = Math.max(0, (y ?? current.lastY) - current.startY);
    const speed = distance / Math.max(1, performance.now() - current.startAt);
    if (distance >= Math.max(CLOSE_MIN_PX, current.height * CLOSE_SHARE) || (distance >= FLICK_MIN_PX && speed >= FLICK_SPEED)) {
      // Stay exactly where the finger let go; the leave animation carries on from `--drag`.
      element.style.transform = `translateY(${distance}px)`;
      element.style.setProperty('--drag', `${distance}px`);
      element.style.setProperty('--fade', Math.max(0, 1 - distance / current.height).toFixed(3));
      released.current = true;
      latest.current.onClose();
    } else {
      settleBack(element);
    }
  }

  function cancel() {
    const current = gesture.current;
    gesture.current = null;
    const element = ref.current;
    if (!current?.active || !element) return;
    setDragging(false);
    settleBack(element);
  }

  // Touch: native listeners, because React's touchmove is passive and so can't stop the page scrolling under the drag.
  const attached = useRef<T | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const handle = useRef({ start, track, end, cancel });
  useEffect(() => { handle.current = { start, track, end, cancel }; });
  useEffect(() => {
    const element = ref.current;
    if (element === attached.current) return;
    detach.current?.();
    attached.current = element;
    detach.current = null;
    if (!element) return;
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { handle.current.cancel(); return; }
      handle.current.start(event.touches[0].clientX ?? 0, event.touches[0].clientY, event.target);
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (handle.current.track(touch.clientX ?? 0, touch.clientY) && event.cancelable) event.preventDefault();
    };
    const onEnd = (event: TouchEvent) => handle.current.end(event.changedTouches[0]?.clientY);
    const onCancel = () => handle.current.cancel();
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onCancel);
    detach.current = () => {
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onCancel);
    };
  });
  // On unmount (and when React re-runs effects in development) let go of the element, so the next run attaches afresh.
  useEffect(() => () => { detach.current?.(); detach.current = null; attached.current = null; clearSettle(); }, []);

  // Mouse and pen. A finger is handled above, so touch pointers are ignored here (one input stream, never two).
  const handlers = {
    onPointerDown: (event: PointerEvent) => { if (event.pointerType !== 'touch' && event.button === 0) start(event.clientX, event.clientY, event.target); },
    onPointerMove: (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !gesture.current) return;
      if (event.buttons === 0) { cancel(); return; }
      track(event.clientX, event.clientY);
    },
    onPointerUp: (event: PointerEvent) => { if (event.pointerType !== 'touch') end(event.clientY); },
    onPointerCancel: (event: PointerEvent) => { if (event.pointerType !== 'touch') cancel(); },
  };
  // The pop-up is moved on the element itself, so there is nothing to hand to `style`; kept so callers keep working.
  const style: CSSProperties | undefined = undefined;
  return { ref, handlers, style, dragging };
}
