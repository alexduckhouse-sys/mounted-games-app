import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CameraLockButtons } from './CameraLocks';

describe('CameraLockButtons', () => {
  it('shows nothing when the camera offers no locks', () => {
    const { container, rerender } = render(<CameraLockButtons locks={undefined} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CameraLockButtons locks={{}} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only the offered locks, marks held ones and flips them', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CameraLockButtons locks={{ exposure: true, whiteBalance: false }} onChange={onChange} className="row" buttonClassName="chip" />);
    const group = screen.getByRole('group', { name: 'Camera locks' });
    expect(group).toHaveClass('row');
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Lock exposure', 'Lock white balance']);
    expect(screen.getByRole('button', { name: 'Lock exposure' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lock white balance' })).toHaveClass('chip');
    await user.click(screen.getByRole('button', { name: 'Lock exposure' }));
    expect(onChange).toHaveBeenLastCalledWith('exposure', false);
    await user.click(screen.getByRole('button', { name: 'Lock white balance' }));
    expect(onChange).toHaveBeenLastCalledWith('whiteBalance', true);
  });

  it('can be disabled while a change is in flight', () => {
    render(<CameraLockButtons locks={{ focus: false }} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Lock focus' })).toBeDisabled();
  });
});
