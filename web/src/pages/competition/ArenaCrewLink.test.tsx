import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { ArenaCrewLink } from './ArenaCrewLink';
import { arenaCrewPath } from './crewDutyHelpers';

it('builds the path with and without a session and heat', () => {
  expect(arenaCrewPath(4)).toBe('/competitions/4/arena-crew');
  expect(arenaCrewPath(4, 2, 9)).toBe('/competitions/4/arena-crew?session=2&heat=9');
  expect(arenaCrewPath(4, null, 9)).toBe('/competitions/4/arena-crew?heat=9');
});

it('links to the sheet and accepts a custom class', () => {
  render(<MemoryRouter><ArenaCrewLink competitionId={4} sessionId={2} heatId={9} /><ArenaCrewLink competitionId={4} className="x" /></MemoryRouter>);
  const links = screen.getAllByRole('link', { name: 'Arena crew sheet' });
  expect(links[0]).toHaveAttribute('href', '/competitions/4/arena-crew?session=2&heat=9');
  expect(links[1]).toHaveClass('x');
});
