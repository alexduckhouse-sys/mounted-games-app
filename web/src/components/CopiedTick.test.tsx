import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { CopiedTick } from './CopiedTick';

it('draws a hidden tick at the size it is given', () => {
  const { container } = render(<CopiedTick />);
  expect(container.querySelector('svg')).toHaveClass('mg-copied-tick', 'h-3.5', 'w-3.5');
  expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  render(<CopiedTick className="h-5 w-5" />);
  expect(document.querySelectorAll('svg')[1]).toHaveClass('h-5', 'w-5');
});
