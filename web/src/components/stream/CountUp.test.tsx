import { render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { CountUp } from './CountUp';

const points = (value: number) => `${value} pts`;

it('counts from the old total to the new one', async () => {
  render(<CountUp from={4} to={10} duration={0.05} format={points} />);
  expect(screen.getByText('4 pts')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('10 pts')).toBeInTheDocument());
});

it('shows the new total at once when nothing changed or motion is stilled', () => {
  const { unmount } = render(<CountUp from={7} to={7} format={points} />);
  expect(screen.getByText('7 pts')).toBeInTheDocument();
  unmount();
  render(<MotionConfig reducedMotion="always"><CountUp from={4} to={10} format={points} /></MotionConfig>);
  expect(screen.getByText('10 pts')).toBeInTheDocument();
});
