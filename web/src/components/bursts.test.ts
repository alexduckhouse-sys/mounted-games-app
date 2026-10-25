import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { confettiBurst, sparkleBurst } from './bursts';

function row() {
  const el = document.createElement('li');
  document.body.appendChild(el);
  return el;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
});

it('throws sparkles under a row and clears them away', () => {
  sparkleBurst(row(), 5);
  expect(document.querySelectorAll('.mg-sparkle')).toHaveLength(5);
  expect(document.querySelector('.mg-sparkle')).toHaveAttribute('aria-hidden', 'true');
  vi.advanceTimersByTime(1600);
  expect(document.querySelectorAll('.mg-sparkle')).toHaveLength(0);
});

it('throws coloured confetti, some round, from a row', () => {
  confettiBurst(row());
  const pieces = [...document.querySelectorAll<HTMLElement>('.mg-confetti')];
  expect(pieces).toHaveLength(30);
  expect(new Set(pieces.map((p) => p.style.background)).size).toBeGreaterThan(1);
  expect(pieces.filter((p) => p.style.borderRadius === '50%')).toHaveLength(10);
  vi.advanceTimersByTime(1600);
  expect(document.querySelectorAll('.mg-confetti')).toHaveLength(0);
});

it('draws inside the full-screen element when there is one', () => {
  const frame = document.createElement('div');
  document.body.appendChild(frame);
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => frame });
  confettiBurst(row(), 3);
  expect(frame.querySelectorAll('.mg-confetti')).toHaveLength(3);
});
