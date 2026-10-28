import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeToClose } from './useSwipeToClose';

const touch = (y: number, target: EventTarget = document.body) => ({ touches: [{ clientY: y }], changedTouches: [{ clientY: y }], target }) as never;
const pointer = (y: number, extra: Record<string, unknown> = {}) => ({ clientY: y, button: 0, buttons: 1, pointerType: 'touch', target: document.body, ...extra }) as never;

describe('useSwipeToClose', () => {
  let clock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { clock = vi.spyOn(performance, 'now').mockReturnValue(0); });
  afterEach(() => { clock.mockRestore(); vi.unstubAllGlobals(); });

  function setup(height = 400, enabled = true) {
    const onClose = vi.fn();
    const hook = renderHook(() => useSwipeToClose<HTMLDivElement>(onClose, enabled));
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({ height }) as DOMRect;
    (hook.result.current.ref as { current: HTMLDivElement | null }).current = element;
    return { hook, onClose, element };
  }
  function slowDrag(hook: ReturnType<typeof setup>['hook'], from: number, to: number) {
    act(() => hook.result.current.handlers.onTouchStart(touch(from)));
    act(() => hook.result.current.handlers.onTouchMove(touch(to)));
    clock.mockReturnValue(1000);
    act(() => hook.result.current.handlers.onTouchEnd(touch(to)));
  }

  it('follows the finger, then slides back from a slow drag short of a quarter', () => {
    const { hook, onClose } = setup();
    act(() => hook.result.current.handlers.onTouchStart(touch(100)));
    act(() => hook.result.current.handlers.onTouchMove(touch(150)));
    expect(hook.result.current.dragging).toBe(true);
    expect(hook.result.current.style).toMatchObject({ transform: 'translateY(50px)', '--drag': '50px', '--fade': '0.875' });
    clock.mockReturnValue(1000);
    act(() => hook.result.current.handlers.onTouchEnd(touch(150)));
    expect(onClose).not.toHaveBeenCalled();
    expect(hook.result.current.dragging).toBe(false);
    expect(hook.result.current.style).toBeUndefined();
  });

  it('closes past a quarter of the height and stays where the finger left it', () => {
    const { hook, onClose } = setup();
    slowDrag(hook, 100, 210);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hook.result.current.style).toMatchObject({ transform: 'translateY(110px)' });
    // Once let go to close, another drag does nothing.
    slowDrag(hook, 100, 400);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes a short pop-up after 48px, and on a quick flick', () => {
    const short = setup(80);
    slowDrag(short.hook, 0, 48);
    expect(short.onClose).toHaveBeenCalledTimes(1);

    const flick = setup();
    act(() => flick.hook.result.current.handlers.onPointerDown(pointer(100)));
    clock.mockReturnValue(30);
    act(() => flick.hook.result.current.handlers.onPointerUp(pointer(130)));
    expect(flick.onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves alone drags from controls, scrolled pop-ups, wide screens, other buttons and when switched off', () => {
    const { hook, onClose, element } = setup();
    const field = document.createElement('input');
    act(() => hook.result.current.handlers.onTouchStart(touch(0, field)));
    act(() => hook.result.current.handlers.onTouchEnd(touch(300)));
    act(() => hook.result.current.handlers.onPointerDown(pointer(0, { button: 2 })));
    act(() => hook.result.current.handlers.onPointerUp(pointer(300)));
    element.scrollTop = 10;
    slowDrag(hook, 0, 300);
    expect(onClose).not.toHaveBeenCalled();

    element.scrollTop = 0;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 640px)' }));
    slowDrag(hook, 0, 300);
    expect(onClose).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    const off = setup(400, false);
    slowDrag(off.hook, 0, 300);
    expect(off.onClose).not.toHaveBeenCalled();
  });

  it('drops the drag on cancel, on a mouse moving with no button down, and ignores moves and ends with no drag', () => {
    const { hook, onClose } = setup();
    act(() => hook.result.current.handlers.onTouchMove(touch(50)));
    act(() => hook.result.current.handlers.onTouchEnd(touch(300)));
    act(() => hook.result.current.handlers.onTouchCancel());
    act(() => hook.result.current.handlers.onTouchStart(touch(0)));
    act(() => hook.result.current.handlers.onTouchMove(touch(200)));
    act(() => hook.result.current.handlers.onTouchCancel());
    expect(hook.result.current.style).toBeUndefined();
    act(() => hook.result.current.handlers.onPointerDown(pointer(0)));
    act(() => hook.result.current.handlers.onPointerMove(pointer(200)));
    act(() => hook.result.current.handlers.onPointerMove(pointer(220, { buttons: 0, pointerType: 'mouse' })));
    expect(hook.result.current.dragging).toBe(false);
    act(() => hook.result.current.handlers.onPointerCancel());
    act(() => hook.result.current.handlers.onPointerUp(pointer(300)));
    // A drag back up past the start counts as no distance at all.
    act(() => hook.result.current.handlers.onTouchStart(touch(100)));
    act(() => hook.result.current.handlers.onTouchMove(touch(40)));
    clock.mockReturnValue(1000);
    act(() => hook.result.current.handlers.onTouchEnd({ touches: [], changedTouches: [] } as never));
    expect(onClose).not.toHaveBeenCalled();
  });
});
