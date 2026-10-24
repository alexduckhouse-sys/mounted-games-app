import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ResultsStatsNav } from './ResultsStatsNav';

describe('ResultsStatsNav', () => {
  it.each([
    ['/seasons', 'Season tables'],
    ['/stats', 'Rider & pony stats'],
    ['/competitions/past', 'Past competitions'],
  ])('marks %s as the current page', (path, activeLabel) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <ResultsStatsNav />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Results and statistics' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: activeLabel })).toHaveAttribute('aria-current', 'page');
    for (const label of ['Season tables', 'Rider & pony stats', 'Past competitions']) {
      if (label !== activeLabel) {
        expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current');
      }
    }
  });
});
