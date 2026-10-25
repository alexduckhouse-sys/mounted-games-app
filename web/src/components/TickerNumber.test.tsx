import { render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { TickerNumber } from './TickerNumber';

const text = (el: HTMLElement) => el.textContent;

it('shows the points, then rolls each changed character to the new value', async () => {
  const { container, rerender } = render(<p data-testid="pts"><TickerNumber value={9} /></p>);
  expect(text(screen.getByTestId('pts'))).toBe('9');
  expect(container.querySelectorAll('.mg-ticker-col')).toHaveLength(1);
  rerender(<p data-testid="pts"><TickerNumber value={10.5} /></p>);
  expect(container.querySelectorAll('.mg-ticker-col')).toHaveLength(4);
  await waitFor(() => expect(text(screen.getByTestId('pts'))).toBe('10.5'));
  rerender(<p data-testid="pts"><TickerNumber value={8} /></p>);
  await waitFor(() => expect(text(screen.getByTestId('pts'))).toBe('8'));
});

it('takes its own format, and is plain text when motion is stilled', () => {
  const { container } = render(<MotionConfig reducedMotion="always"><p data-testid="pts"><TickerNumber value={3} format={(v) => `${v} pts`} /></p></MotionConfig>);
  expect(text(screen.getByTestId('pts'))).toBe('3 pts');
  expect(container.querySelector('.mg-ticker-col')).toBeNull();
});
