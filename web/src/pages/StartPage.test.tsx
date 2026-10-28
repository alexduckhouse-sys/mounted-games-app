import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { AuthProvider } from '../auth/AuthContext';
import { CurrentCompetitionProvider } from '../competition/CurrentCompetitionContext';
import { CompetitionsPage } from './CompetitionsPage';
import { StartPage } from './StartPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn() },
}));

const spring = { id: 4, name: 'Spring Games' };
const cookie = () => { document.cookie = `mg.competition=${encodeURIComponent(JSON.stringify(spring))}; Path=/`; };
const visit = () => sessionStorage.setItem('mg.competitionVisit', JSON.stringify(spring));

function Probe() {
  const { pathname } = useLocation();
  return <span data-testid="probe">{pathname}</span>;
}
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><CurrentCompetitionProvider>
        <Routes>
          <Route path="/" element={<StartPage />} />
          <Route path="/events" element={<CompetitionsPage />} />
          <Route path="/competitions/:id" element={<span>Competition page</span>} />
        </Routes>
        <Probe />
      </CurrentCompetitionProvider></AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: { items: [], hasMore: false }, headers: {} } as never);
});

describe('the start page and the events page', () => {
  it('shows the events list at / when nothing is remembered', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Competitions' })).toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('/');
  });

  it('opens a remembered competition at /', () => {
    cookie();
    renderAt('/');
    expect(screen.getByText('Competition page')).toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('/competitions/4');
  });

  it('shows the events list at / when the competition is only for this visit', async () => {
    visit();
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Competitions' })).toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('/');
  });

  it.each([
    ['nothing saved', () => {}],
    ['a visit', visit],
    ['a remembered competition', cookie],
  ])('always shows the events list at /events, with %s', async (_name, setup) => {
    setup();
    renderAt('/events');
    expect(await screen.findByRole('heading', { level: 1, name: 'Competitions' })).toBeInTheDocument();
    expect(screen.queryByText('Competition page')).not.toBeInTheDocument();
    expect(screen.getByTestId('probe')).toHaveTextContent('/events');
  });
});
