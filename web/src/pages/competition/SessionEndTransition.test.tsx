import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { competition, session } from '../../test/factories';
import type { Session } from '../../types';
import { SessionEndTransition } from './SessionEndTransition';

vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canManage: () => true }) }));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function mount(finished: Session, sessions: Session[]) {
  const onAdvanced = vi.fn();
  render(
    <MemoryRouter initialEntries={['/start']}>
      <Routes>
        <Route path="*" element={
          <>
            <SessionEndTransition competition={competition({ sessions })} finishedSession={finished} onClose={vi.fn()} onAdvanced={onAdvanced} />
            <Where />
          </>
        } />
      </Routes>
    </MemoryRouter>,
  );
  return { onAdvanced };
}

describe('SessionEndTransition', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
  });

  it('moves on to the next session in the same arena, not another arena', async () => {
    const one = session(1, { name: 'Arena 1 morning', arenaName: 'Arena 1', status: 1 });
    const other = session(2, { name: 'Arena 2 morning', arenaName: 'Arena 2' });
    const next = session(3, { name: 'Arena 1 afternoon', arenaName: 'Arena 1' });
    const { onAdvanced } = mount(one, [one, other, next]);

    expect(screen.getByRole('heading', { name: 'Arena 1 afternoon' })).toBeInTheDocument();
    expect(screen.queryByText('Arena 2 morning')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await waitFor(() => expect(onAdvanced).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith('/competitions/1/sessions/1/status', { status: 2 });
    expect(api.put).toHaveBeenCalledWith('/competitions/1/sessions/3/status', { status: 1 });
    expect(api.put).not.toHaveBeenCalledWith('/competitions/1/sessions/2/status', expect.anything());
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/competitions/1/session/3'));
  });

  it('says it was the final session when the rest of the day is in another arena', () => {
    const one = session(1, { arenaName: 'Arena 1', status: 1 });
    mount(one, [one, session(2, { name: 'Elsewhere', arenaName: 'Arena 2' })]);
    expect(screen.getByText('That was the final session.')).toBeInTheDocument();
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument();
  });

  it('shows the next break and real session of the same arena only', () => {
    const one = session(1, { arenaName: 'Arena 1', status: 1 });
    const breakOther = session(2, { name: 'Other break', arenaName: 'Arena 2', isBreak: true, kind: 1 });
    const breakHere = session(3, { name: 'Lunch', arenaName: 'Arena 1', isBreak: true, kind: 1, durationMinutes: 30 });
    const afterHere = session(4, { name: 'Afternoon', arenaName: 'Arena 1' });
    mount(one, [one, breakOther, breakHere, afterHere, session(5, { name: 'Other real', arenaName: 'Arena 2' })]);
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(screen.getByText('Afternoon')).toBeInTheDocument();
    expect(screen.queryByText('Other break')).not.toBeInTheDocument();
    expect(screen.queryByText('Other real')).not.toBeInTheDocument();
  });

  it('treats a missing, empty or blank arena name as the same single arena', () => {
    const one = session(1, { status: 1 });
    const next = session(2, { name: 'Next one', arenaName: '' });
    mount(one, [one, next]);
    expect(screen.getByRole('heading', { name: 'Next one' })).toBeInTheDocument();
  });
});
