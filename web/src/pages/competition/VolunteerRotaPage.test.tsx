import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { VolunteerRotaPage } from './VolunteerRotaPage';

const auth = vi.hoisted(() => ({ organiser: false }));
vi.mock('./context', () => ({ useCompetition: () => ({ competition: { id: 7, name: 'Spring Games', sessions: [] }, reload: vi.fn() }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: null, canOrganise: () => auth.organiser }) }));
vi.mock('../operations/VolunteerRota', () => ({ VolunteerRota: ({ manage }: { manage: boolean }) => <p>Rota (manage: {String(manage)})</p> }));

describe('VolunteerRotaPage', () => {
  it('shows the rota read-only to everyone else', () => {
    auth.organiser = false;
    render(<MemoryRouter><VolunteerRotaPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Volunteer shifts' })).toBeInTheDocument();
    expect(screen.getByText('Rota (manage: false)')).toBeInTheDocument();
  });

  it('gives organisers the editing tools', () => {
    auth.organiser = true;
    render(<MemoryRouter><VolunteerRotaPage /></MemoryRouter>);
    expect(screen.getByText('Rota (manage: true)')).toBeInTheDocument();
  });
});
