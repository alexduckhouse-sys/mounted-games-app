import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GripButton } from '../components/GripButton';
import { useRowDrag } from './useRowDrag';

function Rows({ onMove, group = 'a' }: { onMove: (from: number, to: number) => void; group?: string }) {
  const { grab, keys, lifted, rowStyle } = useRowDrag();
  return (
    <>
      <div data-row-list="">
        {['One', 'Two', 'Three'].map((name, i) => (
          <div key={name} data-race-row="" data-testid={name} data-lifted={lifted(i, group)} style={rowStyle(i, group)}>
            <GripButton label={`Move ${name}`} onPointerDown={(e) => grab(e, i, 3, onMove, group)} onKeyDown={(e) => keys(e, i, 3, onMove)} />
          </div>
        ))}
      </div>
      <div data-testid="other" data-lifted={String(lifted(0, 'b'))} />
    </>
  );
}

describe('useRowDrag', () => {
  it('lifts the grabbed row, slides the others, and reports the move on release', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 50, width: 1, top: 0, left: 0, right: 1, bottom: 50, x: 0, y: 0, toJSON: () => ({}) });
    const onMove = vi.fn();
    render(<Rows onMove={onMove} />);
    fireEvent(screen.getByRole('button', { name: 'Move One' }), new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientY: 10 }));
    expect(screen.getByTestId('One')).toHaveAttribute('data-lifted', 'true');
    expect(screen.getByTestId('other')).toHaveAttribute('data-lifted', 'false');
    fireEvent(window, new MouseEvent('pointermove', { clientY: 110 }));
    expect(screen.getByTestId('One').style.transform).toBe('translateY(100px)');
    expect(screen.getByTestId('Two').style.transform).toBe('translateY(-50px)');
    expect(screen.getByTestId('Three').style.transform).toBe('translateY(-50px)');
    fireEvent(window, new MouseEvent('pointerup', {}));
    expect(onMove).toHaveBeenCalledWith(0, 2);
    expect(screen.getByTestId('One').style.transform).toBe('');
  });

  it('does nothing for other buttons, a drag that ends where it began, or lists of another group', () => {
    const onMove = vi.fn();
    render(<Rows onMove={onMove} />);
    const grip = screen.getByRole('button', { name: 'Move One' });
    fireEvent(grip, new MouseEvent('pointerdown', { bubbles: true, button: 2, clientY: 10 }));
    expect(screen.getByTestId('One')).toHaveAttribute('data-lifted', 'false');
    fireEvent(grip, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 10 }));
    fireEvent(window, new MouseEvent('pointercancel', {}));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('moves a row with the arrow keys, not past either end, and ignores other keys', () => {
    const onMove = vi.fn();
    render(<Rows onMove={onMove} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move One' }), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Three' }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Two' }), { key: 'x' });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Two' }), { key: 'ArrowDown' });
    expect(onMove).toHaveBeenCalledWith(1, 2);
  });
});
