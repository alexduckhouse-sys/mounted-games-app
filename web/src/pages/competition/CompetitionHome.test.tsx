import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { CompetitionHome, TimetableRoute } from './CompetitionHome';

const state = vi.hoisted(() => ({ phase: 'complete' }));
vi.mock('../../lib/competitionPhase', () => ({ competitionPhase: () => state.phase, entryPhaseOnly: () => state.phase === 'entry' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => false }) }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: { id: 9 } }) }));
vi.mock('./MyStewardDutyBanner', () => ({ MyStewardDutyBanner: () => null }));
vi.mock('./SessionsTab', () => ({ SessionsTab: () => <p>Timetable list</p> }));
vi.mock('./ScoringTab', () => ({ ScoringTab: () => <p>Toplist</p> }));
vi.mock('./EntryPage', () => ({ EntryPage: () => <p>Entry page</p> }));

const view = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/competitions/:id">
        <Route index element={<CompetitionHome />} />
        <Route path="timetable" element={<TimetableRoute />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { state.phase = 'complete'; });

it('keeps the toplist as home once finished, with a link to the timetable', async () => {
  view('/competitions/9');
  expect(await screen.findByText('Toplist')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Full timetable' })).toHaveAttribute('href', '/competitions/9/timetable');
});

it('shows the timetable at /timetable after the finish', () => {
  view('/competitions/9/timetable');
  expect(screen.getByText('Timetable list')).toBeInTheDocument();
});

it('sends /timetable back to the entry page before the draw', async () => {
  state.phase = 'entry';
  view('/competitions/9/timetable');
  expect(await screen.findByText('Entry page')).toBeInTheDocument();
});
