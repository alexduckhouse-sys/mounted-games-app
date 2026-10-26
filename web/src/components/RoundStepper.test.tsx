import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoundStepper } from './RoundStepper';

describe('RoundStepper', () => {
  it('shows the number and steps it up and down by one', async () => {
    const onChange = vi.fn();
    render(<RoundStepper name="Hay" value={2} onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Quantity for Hay' })).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('button', { name: 'Add one Hay' }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: 'Remove one Hay' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('stops at the minimum and the maximum', () => {
    const { rerender } = render(<RoundStepper name="Hay" value={0} max={3} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove one Hay' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add one Hay' })).toBeEnabled();
    rerender(<RoundStepper name="Hay" value={3} max={3} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add one Hay' })).toBeDisabled();
  });

  it('can be switched off, and takes its own button labels', () => {
    render(<RoundStepper name="Stables" value={1} disabled addLabel="One more stable" removeLabel="One fewer stable" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'One more stable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'One fewer stable' })).toBeDisabled();
  });
});
