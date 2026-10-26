import { render, screen } from '@testing-library/react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { expect, it } from 'vitest';
import { LeavingRow } from './LeavingRow';

function List({ names, as }: { names: string[]; as?: 'li' | 'div' }) {
  return <ul><AnimatePresence initial={false}>{names.map((name) => <LeavingRow key={name} as={as} className="rf-row">{name}</LeavingRow>)}</AnimatePresence></ul>;
}

it('renders each row as a list item by default, or as a div', () => {
  const { rerender } = render(<List names={['Ann', 'Bob']} />);
  expect(screen.getByText('Ann').tagName).toBe('LI');
  expect(screen.getByText('Ann')).toHaveClass('rf-row');
  rerender(<List names={['Cat']} as="div" />);
  expect(screen.getByText('Cat').tagName).toBe('DIV');
});

it('takes a removed row away at once when motion is stilled', () => {
  const { rerender } = render(<MotionConfig reducedMotion="always"><List names={['Ann', 'Bob']} /></MotionConfig>);
  rerender(<MotionConfig reducedMotion="always"><List names={['Bob']} /></MotionConfig>);
  expect(screen.queryByText('Ann')).toBeNull();
  rerender(<MotionConfig reducedMotion="always"><List names={['Bob', 'Dan']} /></MotionConfig>);
  expect(screen.getByText('Dan')).toBeInTheDocument();
});
