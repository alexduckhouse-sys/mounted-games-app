import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { competition, heat, session, team } from '../test/factories';
import type { CompetitionDetail } from '../types';
import { MyTeamsPage } from './MyTeamsPage';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../hooks/useTeamNotifications', () => ({
  useTeamNotifications: () => ({ enabled: false, permission: 'unsupported', setEnabled: vi.fn() }),
}));

const entries = [{ id: 1, teamId: 1, teamName: 'Example Blue', laneIndex: 4 }];
let detail: CompetitionDetail;

function mount() {
  return render(<MemoryRouter><MyTeamsPage /></MemoryRouter>);
}

beforeEach(() => {
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
