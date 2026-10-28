import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { OperationsPage } from './OperationsPage';

vi.mock('../competition/context', () => ({
  useCompetition: () => ({ competition: { id: 7, name: 'Sample Games', sections: [], sessions: [] }, reload: vi.fn() }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, canOrganise: () => true, hasRole: () => false }),
}));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock('./DrawUndoBanner', () => ({ DrawUndoBanner: () => null }));
vi.mock('./VolunteerRota', () => ({ VolunteerRota: ({ manage }: { manage: boolean }) => <p>Rota (manage: {String(manage)})</p> }));
vi.mock('./EmergencySearch', () => ({ EmergencySearch: ({ competitionId }: { competitionId: number }) => <p>Emergency search for {competitionId}</p> }));

const open = (tool: string) => render(<MemoryRouter initialEntries={[`/competitions/7/operations/${tool}`]}><Routes><Route path="/competitions/:id/operations/:tool" element={<OperationsPage />} /></Routes></MemoryRouter>);

describe('OperationsPage volunteer and emergency pages', () => {
  beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: { competitionId: 7, isReady: true, equipmentFingerprint: 'x', missingDeclarations: [], unpaidSignups: [], incompleteTeams: [], sessionOverlaps: [], equipmentChecklist: [], equipmentIssues: [] } }); });

  it('opens the volunteer rota for organisers', async () => {
    open('volunteers');
    expect(await screen.findByText('Rota (manage: true)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Volunteers' })).toBeInTheDocument();
  });

  it('opens the emergency contact search', async () => {
    open('safety');
    expect(await screen.findByText('Emergency search for 7')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Emergency contacts' })).toBeInTheDocument();
  });
});
