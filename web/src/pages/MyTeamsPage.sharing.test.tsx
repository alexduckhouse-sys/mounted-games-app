import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { MyTeamsPage } from './MyTeamsPage';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', clubName: null }, hasRole: () => false }) }));
vi.mock('../hooks/useTeamNotifications', () => ({
  useTeamNotifications: () => ({ enabled: false, permission: 'default', setEnabled: vi.fn() }),
}));

const TEAM = {
  id: 5, competitionId: 12, competitionSectionId: 3, sectionName: 'Under 12', clubId: 1, clubName: 'Cheshire',
  suffix: 'A', displayName: 'Cheshire A', isHorsConcours: false, relationship: 'trainer', supporterJoinKey: 'ABCD2345',
};

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><MyTeamsPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/trainer/my-teams') return Promise.resolve({ data: [TEAM] });
    if (url === '/teams/5/calendar-feed') return Promise.resolve({ data: { enabled: false, createdAt: null } });
    if (url === '/teams/5/supporters') return Promise.resolve({ data: [] });
    if (url === '/competitions/12') return Promise.resolve({ data: { id: 12, name: 'Spring', sessions: [], teams: [], sections: [] } });
    return Promise.resolve({ data: [] });
  });
});

describe('My teams sharing', () => {
  it('fills the join box from a scanned team QR code', async () => {
    renderAt('/teams?join=abcd2345');
    expect(await screen.findByPlaceholderText('ABCD1234')).toHaveValue('ABCD2345');
  });

  it('leaves the join box empty without a key in the address', async () => {
    renderAt('/teams');
    expect(screen.queryByPlaceholderText('ABCD1234')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Join a team with a code' }));
    expect(await screen.findByPlaceholderText('ABCD1234')).toHaveValue('');
  });

  it('shows the trainer a QR code and the calendar link controls under Supporters', async () => {
    renderAt('/teams');
    await userEvent.click(await screen.findByRole('button', { name: /Supporters/ }));
    expect(await screen.findByRole('img', { name: 'QR code to join Cheshire A' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Create calendar link' })).toBeInTheDocument();
  });
});
