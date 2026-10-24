import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { CompactPageBarProvider, useCompactPageBarState } from '../../components/CompactPageBarContext';
import { FAVOURITES_KEY } from '../../lib/favourites';
import { competition, heat, race, session, team } from '../../test/factories';
import { HeatScores } from './HeatScores';
import { formatPoints } from '../../lib/formatPoints';

const state = vi.hoisted(() => ({ competition: null as unknown }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: state.competition, streams: [] }) }));

afterEach(() => {
  localStorage.clear();
});

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

it('hides the race rules and setup until clicked, then lists each race with a rules button', () => {
  const shownHeat = heat(3, { sessionId: 3, orderIndex: 0, label: 'Heat 1', entries: [{ id: 3, teamId: 3, teamName: 'Ash C', laneIndex: 1 }],
    races: [race(1, { name: 'Bending', orderIndex: 0, isComplete: true }), race(2, { name: 'Sack', orderIndex: 1 })] });
  const shownSession = session(3, { sectionName: 'Teams Seniors', status: 1, scheduledStart: '2026-10-16T10:00:00', heats: [shownHeat] });
  state.competition = competition({ name: 'Autumn Games', startDate: '2026-10-16', sessions: [shownSession] });
  render(<CompactPageBarProvider><MemoryRouter><HeatScores session={shownSession} heats={[shownHeat]} activeHeatId={3} /></MemoryRouter></CompactPageBarProvider>);
  expect(screen.queryByRole('region', { name: 'Races in this heat' })).toBeNull();
  const toggle = screen.getByRole('button', { name: 'Race rules and arena setup' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  const list = screen.getByRole('list');
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(within(list).getByRole('button', { name: 'Rules for Bending' })).toBeInTheDocument();
  expect(within(list).getByRole('button', { name: 'Rules for Sack' })).toBeInTheDocument();
  expect(within(list).getByText(/running/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close race rules and setup' }));
  expect(screen.queryByRole('region', { name: 'Races in this heat' })).toBeNull();
});

it('shows a heat-heat-final session as one unified table of every team against every race round', () => {
  const q1 = heat(11, { sessionId: 9, orderIndex: 0, label: 'Bending · Q1', raceRoundId: 5, raceRoundStage: 1,
    entries: [{ id: 1, teamId: 1, teamName: 'Oak A', laneIndex: 1 }, { id: 2, teamId: 2, teamName: 'Beech B', laneIndex: 2 }],
    races: [race(21, { name: 'Bending', isComplete: true, results: [
      { id: 1, teamId: 1, teamName: 'Oak A', placing: 1, eliminated: false, points: 1 },
      { id: 2, teamId: 2, teamName: 'Beech B', placing: 2, eliminated: true, points: 0 },
    ] })] });
  const q2 = heat(12, { sessionId: 9, orderIndex: 1, label: 'Bending · Q2', raceRoundId: 5, raceRoundStage: 1,
    entries: [{ id: 3, teamId: 3, teamName: 'Ash C', laneIndex: 1 }], races: [race(22, { name: 'Bending', isComplete: true, results: [
      { id: 3, teamId: 3, teamName: 'Ash C', placing: 1, eliminated: false, points: 1 },
    ] })] });
  const final = heat(13, { sessionId: 9, orderIndex: 2, label: 'Bending · Final', raceRoundId: 5, raceRoundStage: 2,
    entries: [{ id: 4, teamId: 1, teamName: 'Oak A', laneIndex: 1 }, { id: 5, teamId: 3, teamName: 'Ash C', laneIndex: 2 }],
    races: [race(23, { name: 'Bending', isComplete: true, results: [
      { id: 4, teamId: 3, teamName: 'Ash C', placing: 1, eliminated: false, points: 5 },
      { id: 5, teamId: 1, teamName: 'Oak A', placing: 2, eliminated: false, points: 4 },
    ] })] });
  const sackQ1 = heat(14, { sessionId: 9, orderIndex: 3, label: 'Sack · Q1', raceRoundId: 6, raceRoundStage: 1,
    entries: [{ id: 6, teamId: 1, teamName: 'Oak A', laneIndex: 1 }],
    races: [race(24, { name: 'Sack', isComplete: false, results: [] })] });
  const sackQ2 = heat(15, { sessionId: 9, orderIndex: 4, label: 'Sack · Q2', raceRoundId: 6, raceRoundStage: 1,
    entries: [{ id: 7, teamId: 2, teamName: 'Beech B', laneIndex: 1 }, { id: 8, teamId: 3, teamName: 'Ash C', laneIndex: 2 }],
    races: [race(25, { name: 'Sack', isComplete: false, results: [] })] });
  const shownSession = session(9, { sectionName: 'Teams Seniors', status: 2, scheduledStart: '2026-10-16T10:00:00', heats: [q1, q2, final, sackQ1, sackQ2] });
  state.competition = competition({ name: 'Autumn Games', startDate: '2026-10-16', sessions: [shownSession] });
  render(<CompactPageBarProvider><MemoryRouter><HeatScores session={shownSession} heats={[q1, q2, final, sackQ1, sackQ2]} activeHeatId={11} /></MemoryRouter></CompactPageBarProvider>);

  const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
  expect(headers.some((text) => text?.includes('Bending'))).toBe(true);
  expect(headers.some((text) => text?.includes('Sack'))).toBe(true);
  // All three teams are on the one unified table, with their totals across the session and Q1/Q2 badges for unscored rounds.
  const oak = screen.getByRole('row', { name: /Oak A/ });
  expect(within(oak).getAllByRole('cell').map((cell) => cell.textContent)).toContain('4');
  expect(within(oak).getByText('Q1')).toBeInTheDocument();
  const beech = screen.getByRole('row', { name: /Beech B/ });
  expect(within(beech).getByText('Q2')).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /Ash C/ })).toBeInTheDocument();
});

it('shows S for a team that sat a race out', () => {
  const shownHeat = heat(15, { sessionId: 5, orderIndex: 0, label: 'Heat 1', entries: [{ id: 1, teamId: 1, teamName: 'Oak A', laneIndex: 1 }],
    races: [race(31, { name: 'Bending', orderIndex: 0, isComplete: true, results: [
      { id: 1, teamId: 1, teamName: 'Oak A', placing: null, eliminated: false, points: 0, isSitOut: true },
    ] })] });
  const shownSession = session(5, { sectionName: 'Teams Seniors', status: 1, scheduledStart: '2026-10-16T10:00:00', heats: [shownHeat] });
  state.competition = competition({ name: 'Autumn Games', startDate: '2026-10-16', sessions: [shownSession] });
  render(<CompactPageBarProvider><MemoryRouter><HeatScores session={shownSession} heats={[shownHeat]} activeHeatId={15} /></MemoryRouter></CompactPageBarProvider>);

  expect(screen.getByText('Sat out this race')).toBeInTheDocument();
});

it('shows the letters for a team that did not start, did not finish, retired or was eliminated', () => {
  const entries = [1, 2, 3, 4].map((id) => ({ id, teamId: id, teamName: `Team ${id}`, laneIndex: id }));
  const out = (id: number, status?: number) => ({ id, teamId: id, teamName: `Team ${id}`, placing: null, eliminated: true, points: 0, ...(status === undefined ? {} : { status }) });
  const shownHeat = heat(16, { sessionId: 6, orderIndex: 0, label: 'Heat 1', entries,
    races: [race(41, { name: 'Bending', orderIndex: 0, isComplete: true, results: [out(1, 2), out(2, 3), out(3, 4), out(4)] })] });
  const shownSession = session(6, { sectionName: 'Teams Seniors', status: 1, scheduledStart: '2026-10-16T10:00:00', heats: [shownHeat] });
  state.competition = competition({ name: 'Autumn Games', startDate: '2026-10-16', sessions: [shownSession] });
  render(<CompactPageBarProvider><MemoryRouter><HeatScores session={shownSession} heats={[shownHeat]} activeHeatId={16} /></MemoryRouter></CompactPageBarProvider>);

  const cell = (name: string) => within(screen.getByRole('row', { name: new RegExp(name) })).getAllByRole('cell').find((c) => /DNS|DNF|^R|^E/.test(c.textContent ?? ''))!;
  expect(cell('Team 1')).toHaveTextContent('DNS');
  expect(cell('Team 2')).toHaveTextContent('DNF');
  expect(cell('Team 3')).toHaveTextContent('R');
  // Results saved before the choice existed have no status and were all eliminations.
  expect(cell('Team 4')).toHaveTextContent('E');
  expect(screen.getByText('Did not start')).toBeInTheDocument();
});

it('pre-fills S for sit-out races before the race is scored and orders rows by starting lane until scored', () => {
  const entries = [
    { id: 1, teamId: 1, teamName: 'Lane One Team', laneIndex: 1 },
    { id: 2, teamId: 2, teamName: 'Lane Two Team', laneIndex: 2 },
    { id: 3, teamId: 3, teamName: 'Lane Three Team', laneIndex: 3 },
    { id: 4, teamId: 4, teamName: 'Lane Four SitOut', laneIndex: 4 },
  ];
  const unscoredHeat = heat(20, {
    sessionId: 7,
    orderIndex: 0,
    label: 'Heat 1',
    entries,
    races: [race(51, { name: 'Bending', orderIndex: 0 }), race(52, { name: 'Mug', orderIndex: 1 })],
  });
  const s = session(7, { sectionName: 'Teams Seniors', status: 0, lanesPerHeat: 3, heats: [unscoredHeat] });
  state.competition = competition({ name: 'Autumn Games', startDate: '2026-10-16', sessions: [s] });
  const { unmount } = render(<CompactPageBarProvider><MemoryRouter><HeatScores session={s} heats={[unscoredHeat]} activeHeatId={20} /></MemoryRouter></CompactPageBarProvider>);

  const rowsBefore = screen.getAllByRole('row').slice(1);
  expect(rowsBefore.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
    'Lane One TeamLane 1',
    'Lane Two TeamLane 2',
    'Lane Three TeamLane 3',
    'Lane Four SitOutSit out',
  ]);
  expect(within(rowsBefore[3]).getAllByText('S').length).toBeGreaterThan(0);
  unmount();

  // Once a race is scored while live, rows re-order by heat leader.
  const liveScoredHeat = heat(20, {
    sessionId: 7,
    orderIndex: 0,
    label: 'Heat 1',
    entries,
    races: [
      race(51, {
        name: 'Bending',
        orderIndex: 0,
        isComplete: true,
        results: [
          { id: 1, teamId: 3, teamName: 'Lane Three Team', placing: 1, eliminated: false, points: 3 },
          { id: 2, teamId: 1, teamName: 'Lane One Team', placing: 2, eliminated: false, points: 2 },
        ],
      }),
      race(52, { name: 'Mug', orderIndex: 1 }),
    ],
  });
  const liveSession = session(7, { sectionName: 'Teams Seniors', status: 1, lanesPerHeat: 3, heats: [liveScoredHeat] });
  state.competition = competition({ name: 'Autumn Games', startDate: '2026-10-16', sessions: [liveSession] });
  render(<CompactPageBarProvider><MemoryRouter><HeatScores session={liveSession} heats={[liveScoredHeat]} activeHeatId={20} /></MemoryRouter></CompactPageBarProvider>);

  const rowsAfter = screen.getAllByRole('row').slice(1);
  expect(rowsAfter[0]).toHaveTextContent('Lane Three Team');
  expect(rowsAfter[1]).toHaveTextContent('Lane One Team');
});

it('shows Carried Forward (CF) column on lettered Finals and includes CF in total points', () => {
  const qualHeat = heat(30, {
    sessionId: 10,
    orderIndex: 0,
    label: 'Heat 1',
    entries: [{ id: 1, teamId: 1, teamName: 'Oak A', laneIndex: 1 }, { id: 2, teamId: 2, teamName: 'Beech B', laneIndex: 2 }],
    races: [
      race(60, {
        name: 'Bending',
        isComplete: true,
        results: [
          { id: 1, teamId: 1, teamName: 'Oak A', placing: 1, eliminated: false, points: 10 },
          { id: 2, teamId: 2, teamName: 'Beech B', placing: 2, eliminated: false, points: 8 },
        ],
      }),
    ],
  });
  const qualSession = session(10, { competitionSectionId: 1, sectionName: 'Teams Seniors', status: 2, heats: [qualHeat] });
  const aFinalHeat = heat(31, {
    sessionId: 11,
    orderIndex: 0,
    label: 'A Final',
    entries: [{ id: 3, teamId: 1, teamName: 'Oak A', laneIndex: 1 }, { id: 4, teamId: 2, teamName: 'Beech B', laneIndex: 2 }],
    races: [
      race(61, {
        name: 'Flag',
        isComplete: true,
        results: [
          { id: 3, teamId: 2, teamName: 'Beech B', placing: 1, eliminated: false, points: 6 },
          { id: 4, teamId: 1, teamName: 'Oak A', placing: 2, eliminated: false, points: 5.01 },
        ],
      }),
    ],
  });
  const finalSession = session(11, { competitionSectionId: 1, sectionName: 'Teams Seniors', status: 2, heats: [aFinalHeat] });
  localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ competitionId: 1, teamId: 1 }]));
  state.competition = competition({ id: 1, name: 'Autumn Games', startDate: '2026-10-16', sessions: [qualSession, finalSession] });

  render(<CompactPageBarProvider><MemoryRouter><HeatScores session={finalSession} heats={[aFinalHeat]} activeHeatId={31} /></MemoryRouter></CompactPageBarProvider>);

  expect(screen.getByRole('columnheader', { name: /CF/ })).toBeInTheDocument();
  const oakRow = screen.getByRole('row', { name: /Oak A/ });
  expect(oakRow).toHaveAttribute('data-followed', 'true');
  // CF = 10, Flag = 5.01 (formatted as 5), Total = 15.01 (formatted as 15)
  const oakCells = within(oakRow).getAllByRole('cell').map((c) => c.textContent);
  expect(oakCells).toContain('10');
  expect(oakCells).toContain('5');
  expect(oakCells).toContain('15');
  expect(within(oakRow).getByRole('link', { name: /Oak A/ })).toHaveAttribute('href', '/competitions/1/teams/1');
  expect(formatPoints(24.01)).toBe('24');
  expect(formatPoints(24.51)).toBe('24.5');
});

it('pre-fills S for a team scheduled to sit out an unscored race and links team names to the team page', () => {
  const entries = [1, 2, 3].map((id) => ({ id, teamId: id, teamName: `Team ${id}`, laneIndex: id }));
  const shownHeat = heat(17, {
    sessionId: 7,
    orderIndex: 0,
    label: 'Heat 1',
    entries,
    races: [race(51, { name: 'Bending', orderIndex: 0, isComplete: false, results: [] })],
  });
  const shownSession = session(7, { sectionName: 'Teams Seniors', status: 1, lanesPerHeat: 2, laneRotationMode: 0, scheduledStart: '2026-10-16T10:00:00', heats: [shownHeat] });
  state.competition = competition({
    id: 42,
    name: 'Autumn Games',
    startDate: '2026-10-16',
    teams: [team(1, { bibDescription: '[flag:gb] Red bibs' }), team(2), team(3)],
    sessions: [shownSession],
  });
  render(<CompactPageBarProvider><MemoryRouter><HeatScores session={shownSession} heats={[shownHeat]} activeHeatId={17} /></MemoryRouter></CompactPageBarProvider>);

  expect(screen.getByRole('link', { name: /Team 1/ })).toHaveAttribute('href', '/competitions/42/teams/1');
  expect(screen.getByRole('row', { name: /Team 1/ }).querySelector('img')).toHaveAttribute('src', '/flags/gb.png');
  const row3 = screen.getByRole('row', { name: /Team 3/ });
  expect(within(row3).getByText('Sat out this race')).toBeInTheDocument();
});
