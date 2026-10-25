import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ScoreFlash } from './ScoreFlash';

it('lights up when the points change, not when they first appear', () => {
  const { rerender } = render(<ScoreFlash value={10} className="pts">10</ScoreFlash>);
  const first = screen.getByText('10');
  expect(first).toHaveClass('pts');
  expect(first).not.toHaveClass('mg-score-flash');

  rerender(<ScoreFlash value={10} className="pts">10</ScoreFlash>);
  expect(screen.getByText('10')).toBe(first);

  rerender(<ScoreFlash value={16} className="pts">16</ScoreFlash>);
  const flashed = screen.getByText('16');
  expect(flashed).toHaveClass('pts', 'mg-score-flash');

  // A second change starts the flash again on a fresh element.
  rerender(<ScoreFlash value={18} className="pts">18</ScoreFlash>);
  expect(screen.getByText('18')).not.toBe(flashed);
  expect(screen.getByText('18')).toHaveClass('mg-score-flash');
});

it('leaves out the class attribute when there is nothing to add', () => {
  render(<ScoreFlash value={3}>3</ScoreFlash>);
  expect(screen.getByText('3')).not.toHaveAttribute('class');
});
