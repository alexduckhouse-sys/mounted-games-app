import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { RulesLink } from './RulesLink';

vi.mock('./context', () => ({ useCompetition: () => ({ competition: { id: 7 } }) }));

it('links to the rulebooks for this competition', () => {
  render(<MemoryRouter><RulesLink className="ml-auto" /></MemoryRouter>);
  const link = screen.getByRole('link', { name: 'Rules' });
  expect(link).toHaveAttribute('href', '/competitions/7/rulebooks');
  expect(link).toHaveClass('ml-auto');
});
