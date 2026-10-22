import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DemoEventBadge, DemoEventNotice } from './DemoEventNotice';

describe('demo event labels', () => {
  it('says plainly that the event is a sample and payments are tests', () => {
    render(<DemoEventNotice />);
    expect(screen.getByRole('note')).toHaveTextContent('Demo event');
    expect(screen.getByRole('note')).toHaveTextContent('The teams and results are made up');
    expect(screen.getByRole('note')).toHaveTextContent('no money is taken');
  });

  it('badges a card and accepts extra classes', () => {
    render(<DemoEventBadge className="self-start" />);
    expect(screen.getByText('Demo event')).toHaveClass('self-start');
  });
});
