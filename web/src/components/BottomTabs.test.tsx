import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BottomTabs } from './BottomTabs';

const current = (path: string) => {
  render(<MemoryRouter initialEntries={[path]}><BottomTabs competitionId={12} /></MemoryRouter>);
  return screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent);
};

describe('BottomTabs', () => {
  it('links to the four places inside the competition', () => {
    render(<MemoryRouter initialEntries={['/competitions/12']}><BottomTabs competitionId={12} /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Competition' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Timetable', '/competitions/12'],
      ['Toplists', '/competitions/12/toplists'],
      ['Live & stream', '/competitions/12/chat'],
      ['Details', '/competitions/12/details'],
    ]);
  });

  it.each([
    ['/competitions/12', 'Timetable'],
    ['/competitions/12/', 'Timetable'],
    ['/competitions/12/session/3', 'Timetable'],
    ['/competitions/12/scoring', 'Timetable'],
    ['/competitions/12/toplists', 'Toplists'],
    ['/competitions/12/chat', 'Live & stream'],
    ['/competitions/12/details/', 'Details'],
  ])('highlights the right tab at %s', (path, tab) => {
    expect(current(path)).toEqual([tab]);
  });

  it('highlights nothing on a page it has no tab for', () => {
    expect(current('/competitions/12/teams')).toEqual([]);
  });
});
