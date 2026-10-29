import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeToClose } from './useSwipeToClose';

let renders = 0;
function Probe({ onClose, enabled = true, height = 400 }: { onClose: () => void; enabled?: boolean; height?: number }) {
  const { ref, handlers, dragging } = useSwipeToClose<HTMLDivElement>(onClose, enabled);
  renders += 1;
  return (
    <div
      ref={(node) => {
        (ref as { current: HTMLDivElement | null }).current = node;
        if (node) node.getBoundingClientRect = () => ({ height }) as DOMRect;
      }}
      data-testid="pop"
      data-dragging={dragging}
      {...handlers}
    >
      <ul data-testid="list"><li data-testid="row">Row</li></ul>
      <input aria-label="Name" />
    </div>
  );
}

const pop = () => screen.getByTestId('pop');
const touches = (y: number, x = 0) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
const ended = (y: number, x = 0) => ({ touches: [], changedTouches: [{ clientX: x, clientY: y }] });

describe('useSwipeToClose', () => {
  let clock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { renders = 0; clock = vi.spyOn(performance, 'now').mockReturnValue(0); });
  afterEach(() => { clock.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  /** A slow pull, so it is judged by distance and not as a flick. */
  function pull(from: number, to: number, target: Element = pop()) {
    fireEvent.touchStart(target, touches(from));
    fireEvent.touchMove(target, touches(to));
    clock.mockReturnValue(1000);
    fireEvent.touchEnd(target, ended(to));
    clock.mockReturnValue(0);
  }

  it('moves the pop-up on the element without re-rendering for every move', () => {
    render(<Probe onClose={vi.fn()} />);
    fireEvent.touchStart(pop(), touches(100));
    fireEvent.touchMove(pop(), touches(130));
    expect(pop().style.transform).toBe('translateY(30px)');
    expect(pop().style.transition).toBe('none');
    expect(pop().style.getPropertyValue('--drag')).toBe('30px');
    expect(pop().style.getPropertyValue('--fade')).toBe('0.925');
    expect(pop()).toHaveAttribute('data-dragging', 'true');
    const after = renders;
    for (let y = 140; y <= 200; y += 10) fireEvent.touchMove(pop(), touches(y));
    expect(pop().style.transform).toBe('translateY(100px)');
    expect(renders).toBe(after);
  });

  it('takes over the touch so the page does not scroll, and eases back from a slow short pull', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onClose = vi.fn();
    render(<Probe onClose={onClose} />);
    fireEvent.touchStart(pop(), touches(100));
    expect(fireEvent.touchMove(pop(), touches(150))).toBe(false);
    clock.mockReturnValue(1000);
    fireEvent.touchEnd(pop(), ended(150));
    expect(onClose).not.toHaveBeenCalled();
    expect(pop()).toHaveAttribute('data-dragging', 'false');
    expect(pop().style.transform).toBe('');
    expect(pop().style.transition).toContain('220ms');
    act(() => { vi.advanceTimersByTime(300); });
    expect(pop().style.transition).toBe('');
    expect(pop().style.getPropertyValue('--drag')).toBe('');
  });

  it('closes past a quarter of the height and stays where the finger left it', () => {
    const onClose = vi.fn();
    render(<Probe onClose={onClose} />);
    pull(100, 210);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pop().style.transform).toBe('translateY(110px)');
    expect(pop().style.getPropertyValue('--drag')).toBe('110px');
    // Once let go to close, another drag does nothing.
    pull(100, 400);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes a short pop-up after 48px, and on a quick flick', () => {
    const short = vi.fn();
    const { unmount } = render(<Probe onClose={short} height={80} />);
    pull(0, 48);
    expect(short).toHaveBeenCalledTimes(1);
    unmount();

    const flick = vi.fn();
    render(<Probe onClose={flick} />);
    fireEvent.touchStart(pop(), touches(100));
    clock.mockReturnValue(10);
    fireEvent.touchMove(pop(), touches(130));
    clock.mockReturnValue(30);
    fireEvent.touchEnd(pop(), ended(130));
    expect(flick).toHaveBeenCalledTimes(1);
  });

  it('leaves alone upward and sideways moves and taps, so scrolling and swiping inside keep working', () => {
    const onClose = vi.fn();
    render(<Probe onClose={onClose} />);
    fireEvent.touchStart(pop(), touches(300));
    expect(fireEvent.touchMove(pop(), touches(250))).toBe(true);
    fireEvent.touchEnd(pop(), ended(250));
    fireEvent.touchStart(pop(), touches(100, 100));
    expect(fireEvent.touchMove(pop(), touches(120, 200))).toBe(true);
    fireEvent.touchEnd(pop(), ended(120, 200));
    // A tiny wobble is neither: nothing moves.
    fireEvent.touchStart(pop(), touches(100));
    fireEvent.touchMove(pop(), touches(103));
    fireEvent.touchEnd(pop(), ended(103));
    expect(pop().style.transform).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not drag while a scroller under the finger, or the pop-up itself, is scrolled', () => {
    const onClose = vi.fn();
    render(<Probe onClose={onClose} />);
    const list = screen.getByTestId('list');
    Object.defineProperty(list, 'scrollTop', { value: 20, configurable: true });
    pull(0, 300, screen.getByTestId('row'));
    expect(onClose).not.toHaveBeenCalled();
    expect(pop().style.transform).toBe('');
    Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true });
    Object.defineProperty(pop(), 'scrollTop', { value: 5, configurable: true });
    pull(0, 300, screen.getByTestId('row'));
    expect(onClose).not.toHaveBeenCalled();
    // At the top again, the same pull closes it.
    Object.defineProperty(pop(), 'scrollTop', { value: 0, configurable: true });
    pull(0, 300, screen.getByTestId('row'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores drags from fields, on wide screens, when switched off and with two fingers', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Probe onClose={onClose} />);
    pull(0, 300, screen.getByLabelText('Name'));
    expect(onClose).not.toHaveBeenCalled();

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 640px)' }));
    pull(0, 300);
    expect(onClose).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    rerender(<Probe onClose={onClose} enabled={false} />);
    pull(0, 300);
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Probe onClose={onClose} />);

    fireEvent.touchStart(pop(), touches(0));
    fireEvent.touchMove(pop(), touches(100));
    expect(pop().style.transform).toBe('translateY(100px)');
    fireEvent.touchStart(pop(), { touches: [{ clientX: 0, clientY: 0 }, { clientX: 50, clientY: 0 }] });
    expect(pop().style.transform).toBe('');
    fireEvent.touchEnd(pop(), ended(300));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('eases back when the browser cancels the touch, and ignores strays', () => {
    const onClose = vi.fn();
    render(<Probe onClose={onClose} />);
    fireEvent.touchMove(pop(), touches(50));
    fireEvent.touchEnd(pop(), ended(300));
    fireEvent.touchCancel(pop());
    fireEvent.touchStart(pop(), touches(0));
    fireEvent.touchMove(pop(), touches(200));
    fireEvent.touchCancel(pop());
    expect(pop().style.transform).toBe('');
    expect(pop()).toHaveAttribute('data-dragging', 'false');
    // A touch with no points at all is ignored, and ending without a position uses the last one.
    fireEvent.touchMove(pop(), { touches: [] });
    fireEvent.touchStart(pop(), touches(0));
    fireEvent.touchMove(pop(), touches(200));
    clock.mockReturnValue(1000);
    fireEvent.touchEnd(pop(), { touches: [], changedTouches: [] });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets a mouse or pen drag with the pointer handlers, but never a finger (one input stream)', () => {
    const onClose = vi.fn();
    render(<Probe onClose={onClose} />);
    fireEvent.pointerDown(pop(), { clientY: 0, button: 0, buttons: 1, pointerType: 'touch' });
    fireEvent.pointerMove(pop(), { clientY: 200, buttons: 1, pointerType: 'touch' });
    fireEvent.pointerUp(pop(), { clientY: 200, pointerType: 'touch' });
    fireEvent.pointerCancel(pop(), { pointerType: 'touch' });
    expect(pop().style.transform).toBe('');

    fireEvent.pointerDown(pop(), { clientY: 0, button: 2, buttons: 2, pointerType: 'mouse' });
    fireEvent.pointerMove(pop(), { clientY: 200, buttons: 2, pointerType: 'mouse' });
    expect(pop().style.transform).toBe('');

    fireEvent.pointerDown(pop(), { clientY: 0, button: 0, buttons: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(pop(), { clientY: 60, buttons: 1, pointerType: 'mouse' });
    expect(pop().style.transform).toBe('translateY(60px)');
    // The button was let go outside the pop-up: the next move sees no button and lets it settle back.
    fireEvent.pointerMove(pop(), { clientY: 70, buttons: 0, pointerType: 'mouse' });
    expect(pop().style.transform).toBe('');

    fireEvent.pointerDown(pop(), { clientY: 0, button: 0, buttons: 1, pointerType: 'pen' });
    fireEvent.pointerMove(pop(), { clientY: 60, buttons: 1, pointerType: 'pen' });
    fireEvent.pointerCancel(pop(), { pointerType: 'pen' });
    expect(pop().style.transform).toBe('');

    fireEvent.pointerDown(pop(), { clientY: 0, button: 0, buttons: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(pop(), { clientY: 200, buttons: 1, pointerType: 'mouse' });
    clock.mockReturnValue(1000);
    fireEvent.pointerUp(pop(), { clientY: 200, pointerType: 'mouse' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
