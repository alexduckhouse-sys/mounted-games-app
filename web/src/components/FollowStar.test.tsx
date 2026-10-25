import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { FollowStar } from './FollowStar';

const burst = (container: HTMLElement) => container.querySelector('.mg-follow-burst');

it('pops with sparks only when you follow, not on first draw or unfollow', () => {
  const { container, rerender } = render(<FollowStar on />);
  expect(burst(container)).toBeNull();
  expect(container.querySelector('svg')).toHaveClass('fill-current');
  rerender(<FollowStar on={false} />);
  expect(burst(container)).toBeNull();
  expect(container.querySelector('svg')).not.toHaveClass('fill-current');
  rerender(<FollowStar on />);
  expect(burst(container)!.querySelectorAll('i')).toHaveLength(6);
});

it('takes a size class and stays still in lite mode', () => {
  const { container, rerender } = render(<MotionConfig reducedMotion="always"><FollowStar on={false} className="h-4 w-4" /></MotionConfig>);
  expect(container.querySelector('svg')).toHaveClass('h-4', 'w-4');
  rerender(<MotionConfig reducedMotion="always"><FollowStar on className="h-4 w-4" /></MotionConfig>);
  expect(burst(container)).toBeNull();
});
