import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SwipeSheet } from './SwipeSheet';

describe('SwipeSheet', () => {
  it('passes its props and ref through and closes when pulled well down', () => {
    const onClose = vi.fn();
    const ref = { current: null as HTMLDivElement | null };
    render(<SwipeSheet ref={ref} onClose={onClose} role="dialog" aria-label="Rules"><span>Body</span></SwipeSheet>);
    const sheet = screen.getByRole('dialog', { name: 'Rules' });
    expect(ref.current).toBe(sheet);
    sheet.getBoundingClientRect = () => ({ height: 200 }) as DOMRect;
    fireEvent.touchStart(sheet, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientY: 260 }] });
    expect(sheet.style.transform).toBe('translateY(160px)');
    fireEvent.touchEnd(sheet, { changedTouches: [{ clientY: 260 }] });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('springs back and stays open after a short pull', () => {
    const onClose = vi.fn();
    render(<SwipeSheet onClose={onClose} role="dialog" aria-label="Rules"><span>Body</span></SwipeSheet>);
    const sheet = screen.getByRole('dialog');
    sheet.getBoundingClientRect = () => ({ height: 400 }) as DOMRect;
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    fireEvent.touchStart(sheet, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientY: 120 }] });
    clock.mockReturnValue(5000);
    fireEvent.touchEnd(sheet, { changedTouches: [{ clientY: 120 }] });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
    clock.mockRestore();
  });
});
