import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionConfig } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

const mount = (onClose = vi.fn(), motion = false, props: Partial<Parameters<typeof Sheet>[0]> = {}) => {
  render(
    <MotionConfig reducedMotion={motion ? 'never' : 'always'}>
      <Sheet title="Two Flag" description="A flag moves between two cones." onClose={onClose} {...props}>
        {({ close }) => <button type="button" className="kit-pill" onClick={() => close()}>Close</button>}
      </Sheet>
    </MotionConfig>,
  );
  return onClose;
};

describe('Sheet', () => {
  it('opens as a modal with a heading, a description and a handle', () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Two Flag' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAccessibleDescription('A flag moves between two cones.');
    expect(dialog).toHaveClass('kit-sheet', 'mg-sheet');
    expect(dialog.querySelector('.kit-sheet-grip')).not.toBeNull();
  });

  it('closes from its own button, and slides away first when motion is on', async () => {
    const onClose = mount(vi.fn(), true);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toHaveClass('is-closing');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('can run something else after it has gone', async () => {
    const onClose = vi.fn();
    const after = vi.fn();
    render(<MotionConfig reducedMotion="always"><Sheet title="t" onClose={onClose}>{({ close }) => <button type="button" onClick={() => close(after)}>Go</button>}</Sheet></MotionConfig>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(after).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape and on a tap on the dim behind it', () => {
    const onClose = mount();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('ignores Escape, swipes and the backdrop when it must be answered', () => {
    const onClose = mount(vi.fn(), false, { dismissible: false });
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    fireEvent.click(dialog);
    fireEvent.touchStart(dialog, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 300 }] });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('follows a swipe down and closes when it is far enough, but not from inside a field', () => {
    const onClose = vi.fn();
    render(<MotionConfig reducedMotion="always"><Sheet title="t" onClose={onClose}><input aria-label="Name" /></Sheet></MotionConfig>);
    const dialog = screen.getByRole('dialog');
    fireEvent.touchStart(screen.getByLabelText('Name'), { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(dialog, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 200 }] });
    expect(onClose).not.toHaveBeenCalled();

    // A slow, short drag (400ms for 20px) slides back rather than closing.
    const clock = vi.spyOn(performance, 'now');
    clock.mockReturnValue(1000);
    fireEvent.pointerDown(dialog, { clientY: 100 });
    fireEvent.pointerMove(dialog, { clientY: 120, buttons: 1 });
    expect(dialog).toHaveStyle({ transform: 'translateY(20px)' });
    expect(dialog).toHaveClass('is-dragging');
    expect(dialog.style.transition).toBe('none');
    clock.mockReturnValue(1400);
    fireEvent.pointerUp(dialog, { clientY: 120 });
    expect(dialog).not.toHaveClass('is-dragging');
    expect(dialog.style.transform).toBe('');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.touchStart(dialog, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(dialog, { touches: [{ clientY: 160 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 160 }] });
    expect(onClose).toHaveBeenCalledTimes(1);
    clock.mockRestore();
  });

  it('takes plain children, and focuses the control it was told to', () => {
    render(<MotionConfig reducedMotion="always"><Sheet title="t" onClose={vi.fn()} initialFocus="[data-first]"><button type="button">One</button><button type="button" data-first>Two</button></Sheet></MotionConfig>);
    expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus();
  });

  it('closes the dialog element when it goes away', () => {
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    const { unmount } = render(<MotionConfig reducedMotion="always"><Sheet title="t" onClose={vi.fn()}>x</Sheet></MotionConfig>);
    unmount();
    expect(close).toHaveBeenCalled();
  });
});
