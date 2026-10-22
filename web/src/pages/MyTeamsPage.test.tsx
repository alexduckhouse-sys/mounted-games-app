import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition, heat, session, team } from '../test/factories';
import type { CompetitionDetail } from '../types';
import { formatTime, roundTo5Min } from '../lib/time';
import { MyTeamsPage } from './MyTeamsPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
const auth = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasRole: (role: string) => auth.roles.includes(role) }) }));
vi.mock('../hooks/useTeamNotifications', () => ({
  useTeamNotifications: () => ({ enabled: false, permission: 'unsupported', setEnabled: vi.fn() }),
}));

const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 4 }];
let detail: CompetitionDetail;

function mount() {
  return render(<MemoryRouter><MyTeamsPage /></MemoryRouter>);
}

beforeEach(() => {
  auth.roles = [];
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/trainer/my-teams') return { data: [team(1, { displayName: 'Example Blue', relationship: 'supporter' })] };
    if (url === '/trainer/notes') return { data: [] };
    return { data: detail };
  });
});

describe('MyTeamsPage heat rows', () => {
  it('shows the starting lane, and the arena only when there is more than one', async () => {
    detail = competition({ sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { label: 'Heat A', entries })] }), session(2, { arenaName: 'Ring 2' })] });
    const first = mount();
    await waitFor(() => expect(screen.getByText('Lane 4')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText(/Heat A · Main Arena/)).toBeInTheDocument();
    first.unmount();
    detail = competition({ sessions: [session(1, { arenaName: 'Main Arena', heats: [heat(1, { label: 'Heat A', entries })] })] });
    mount();
    await waitFor(() => expect(screen.getByText('Lane 4')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByText(/Main Arena/)).not.toBeInTheDocument();
  });
});

describe('MyTeamsPage heat times', () => {
  it('counts a break before the heat, so the afternoon heat is not shown too early', async () => {
    const at = (h: number, m: number) => new Date(2026, 5, 1, h, m).toISOString();
    detail = competition({ sessions: [
      session(1, { orderIndex: 1, scheduledStart: at(9, 0), heats: [heat(1, { label: 'Morning', durationMinutes: 30, entries })] }),
      session(2, { orderIndex: 2, kind: 1, isBreak: true, durationMinutes: 45 }),
      session(3, { orderIndex: 3, heats: [heat(3, { label: 'Afternoon', durationMinutes: 30, entries })] }),
    ] });
    mount();
    const expected = formatTime(roundTo5Min(new Date(2026, 5, 1, 10, 15)));
    const row = await screen.findByText(/Afternoon/, undefined, { timeout: 5000 });
    expect(row.parentElement).toHaveTextContent(expected);
  });
});

describe('MyTeamsPage for a club manager', () => {
  it('lets the manager choose the trainer and describe the bibs, then saves both', async () => {
    auth.roles = ['Manager'];
    detail = competition();
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/trainer/my-teams') return { data: [team(1, { displayName: 'Example Blue', relationship: 'manager', clubId: 7 })] };
      if (url === '/trainer/notes') return { data: [] };
      if (url === '/clubs/7/trainers') return { data: [{ userId: 'tr-1', fullName: 'Pat Trainer' }] };
      if (url === '/admin/trainer-requests' || url.endsWith('/supporters')) return { data: [] };
      return { data: detail };
    });
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    mount();
    await screen.findByRole('option', { name: 'Pat Trainer' }, { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('Trainer'), { target: { value: 'tr-1' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Red bibs, numbered 1 to 5'), { target: { value: 'Blue bibs 1-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save team details' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/teams/1/trainer', { trainerUserId: 'tr-1', bibDescription: 'Blue bibs 1-5' }));
    expect(await screen.findByText('Saved.', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Your club')).toBeInTheDocument();
  });
});
