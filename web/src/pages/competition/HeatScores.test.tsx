import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { competition, heat, race, session, team } from '../../test/factories';
import { HeatScores } from './HeatScores';

const state = vi.hoisted(() => ({ competition: null as unknown }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: state.competition, streams: [] }) }));

function BarProbe() {
  const { config } = useCompactPageBarState();
  return <output data-testid="bar">{config ? `${config.title}|${config.subtitle}|${config.badge}` : 'none'}</output>;
}

it('moves the live heat identity into the score table and publishes the compact shell bar', () => {
  const firstRace = race(1, { name: 'Bending', orderIndex: 0 });
  const shownHeat = heat(1, { sessionId: 1, orderIndex: 0, label: 'Heat 2', races: [firstRace], entries: [
    { id: 1, teamId: team(1).id, teamName: 'Oak A', laneIndex: 0 },
  ] });
  const shownSession = session(1, { sectionName: 'Teams Under 12', arenaName: 'Main Arena', status: 1, scheduledStart: '2026-10-16T10:00:00', heats: [shownHeat] });
  state.competition = competition({ name: 'Autumn Games', startDate: '2026-10-16', sessions: [shownSession] });
  render(<CompactPageBarProvider><MemoryRouter><BarProbe /><HeatScores session={shownSession} heats={[shownHeat]} activeHeatId={1} /></MemoryRouter></CompactPageBarProvider>);
  expect(screen.getByRole('heading', { name: 'Under 12 Heat 2 scores' })).toHaveClass('sr-only');
  expect(screen.getByRole('columnheader', { name: /Under 12Heat 2Race 1 of 1 · Bending Team/ })).toBeVisible();
  expect(screen.getByTestId('bar')).toHaveTextContent('Autumn Games|Under 12 heats · Main Arena|live');
  expect(screen.queryByText('Timetable')).toBeNull();
});

it('keeps the delay visible in the table while the compact bar labels the heat as next', () => {
  const shownHeat = heat(2, { sessionId: 2, orderIndex: 0, label: 'Heat 3', entries: [{ id: 2, teamId: 2, teamName: 'Beech B', laneIndex: 0 }] });
  const shownSession = session(2, { sectionName: 'Teams Seniors', arenaName: 'Arena Two', scheduledStart: '2026-10-16T10:00:00', startedAt: '2026-10-16T10:12:00', heats: [shownHeat] });
  state.competition = competition({ name: 'Autumn Games', startDate: '2026-10-16', sessions: [shownSession] });
  render(<CompactPageBarProvider><MemoryRouter><BarProbe /><HeatScores session={shownSession} heats={[shownHeat]} activeHeatId={2} /></MemoryRouter></CompactPageBarProvider>);
  expect(screen.getByRole('columnheader', { name: /running 12 min late/ })).toBeVisible();
  expect(screen.getByTestId('bar')).toHaveTextContent('|next');
});

it('lists each race with a rules button, marking the one running', () => {
  const shownHeat = heat(3, { sessionId: 3, orderIndex: 0, label: 'Heat 1', entries: [{ id: 3, teamId: 3, teamName: 'Ash C', laneIndex: 1 }],
    races: [race(1, { name: 'Bending', orderIndex: 0, isComplete: true }), race(2, { name: 'Sack', orderIndex: 1 })] });
  const shownSession = session(3, { sectionName: 'Teams Seniors', status: 1, scheduledStart: '2026-10-16T10:00:00', heats: [shownHeat] });
  state.competition = competition({ name: 'Autumn Games', startDate: '2026-10-16', sessions: [shownSession] });
  render(<CompactPageBarProvider><MemoryRouter><HeatScores session={shownSession} heats={[shownHeat]} activeHeatId={3} /></MemoryRouter></CompactPageBarProvider>);
  const list = screen.getByRole('list');
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(within(list).getByRole('button', { name: 'Rules for Bending' })).toBeInTheDocument();
  expect(within(list).getByRole('button', { name: 'Rules for Sack' })).toBeInTheDocument();
  expect(within(list).getByText(/running/)).toBeInTheDocument();
});
