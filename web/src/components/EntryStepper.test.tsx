import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EntryStepper } from './EntryStepper';

const steps = () => within(screen.getByRole('list', { name: 'Entry steps' })).getAllByRole('listitem');

describe('EntryStepper', () => {
  it('marks the current step, ticks the finished ones and leaves the rest numbered', () => {
    render(<EntryStepper labels={['Section', 'Your details', 'Pay']} current={2} />);
    expect(steps().map((s) => s.getAttribute('data-state'))).toEqual(['done', 'cur', 'todo']);
    expect(steps()[1]).toHaveAttribute('aria-current', 'step');
    expect(steps()[0]).not.toHaveAttribute('aria-current');
    expect(within(steps()[0]).getByLabelText('Done')).toBeInTheDocument();
    expect(steps()[2]).toHaveTextContent('3Pay');
  });

  it('fills the line in proportion to how far you have got', () => {
    const { container, rerender } = render(<EntryStepper labels={['A', 'B', 'C']} current={1} />);
    const fill = () => container.querySelector<HTMLElement>('.ev-fill')!;
    expect(fill().style.width).toBe('0%');
    rerender(<EntryStepper labels={['A', 'B', 'C']} current={2} />);
    expect(fill().style.width).toBe('50%');
    rerender(<EntryStepper labels={['A', 'B', 'C']} current={3} />);
    expect(fill().style.width).toBe('100%');
  });

  it('ticks every step once everything is done', () => {
    const { container } = render(<EntryStepper labels={['A', 'B']} current={3} />);
    expect(steps().map((s) => s.getAttribute('data-state'))).toEqual(['done', 'done']);
    expect(container.querySelector<HTMLElement>('.ev-fill')!.style.width).toBe('100%');
  });

  it('copes with a single step', () => {
    const { container } = render(<EntryStepper labels={['Only']} current={1} />);
    expect(container.querySelector<HTMLElement>('.ev-fill')!.style.width).toBe('0%');
    expect(steps()).toHaveLength(1);
  });
});
