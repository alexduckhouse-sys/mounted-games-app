import { animate } from 'framer-motion';

// Throwaway sparkles and confetti drawn over the page at a row's position. They live outside React (fixed to the
// viewport, so a card's rounded clipping can't cut them off) and remove themselves when done. Callers skip them
// when motion is stilled.

const CONFETTI_COLOURS = ['#F5B82E', 'rgb(225 42 57)', '#1F4E8C', '#4ADE80', '#38BDF8'];
const LIFETIME_MS = 1600;

function piece(className: string, x: number, y: number): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  // In real full screen only the full-screen element is drawn.
  (document.fullscreenElement ?? document.body).appendChild(el);
  setTimeout(() => el.remove(), LIFETIME_MS);
  return el;
}

/** A few small stars that twinkle out from under a row. */
export function sparkleBurst(target: Element, count = 4) {
  const box = target.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const el = piece('mg-sparkle', box.left + box.width * (0.1 + Math.random() * 0.8), box.bottom - 4);
    void animate(el, {
      opacity: [0, 1, 0],
      scale: [0.2, 1, 0.3],
      rotate: [0, 90 + Math.random() * 90],
      x: [0, (Math.random() - 0.5) * 30],
      y: [0, 6 + Math.random() * 14],
    }, { duration: 0.7 + Math.random() * 0.2, ease: 'easeOut' });
  }
}

/** A short pop of confetti thrown up out of a row's box, then falling away. */
export function confettiBurst(target: Element, count = 30) {
  const box = target.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const el = piece('mg-confetti', box.left + box.width * Math.random(), box.top + box.height * (0.3 + Math.random() * 0.4));
    el.style.background = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
    if (i % 3 === 0) el.style.borderRadius = '50%';
    const rise = 40 + Math.random() * 70;
    void animate(el, {
      x: [0, (Math.random() - 0.5) * 140],
      y: [0, -rise, 70 + Math.random() * 90],
      rotate: [0, (Math.random() - 0.5) * 720],
      opacity: [1, 1, 0],
    }, { duration: 1 + Math.random() * 0.3, ease: ['easeOut', 'easeIn'], times: [0, 0.35, 1] });
  }
}
