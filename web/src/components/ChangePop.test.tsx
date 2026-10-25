import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ChangePop } from './ChangePop';

it('pops a status when it changes, not when it first shows, and ticks good news', () => {
  const { container, rerender } = render(<ChangePop value="Awaiting payment">Awaiting payment</ChangePop>);
  expect(container.querySelector('.mg-change-pop')).toBeNull();
  rerender(<ChangePop value="Awaiting payment">Awaiting payment</ChangePop>);
  expect(container.querySelector('.mg-change-pop')).toBeNull();
  rerender(<ChangePop value="Paid" tick>Paid</ChangePop>);
  const popped = container.querySelector('.mg-change-pop')!;
  expect(popped).toHaveTextContent('Paid');
  expect(popped.querySelector('svg')).not.toBeNull();
  rerender(<ChangePop value="Refunded">Refunded</ChangePop>);
  expect(screen.getByText('Refunded')).not.toBe(popped);
  expect(container.querySelector('.mg-change-pop svg')).toBeNull();
});
