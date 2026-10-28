import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { CompetitionDetail } from '../../types';
import { eventHasStarted } from '../operations/hubData';
import { BeforeTheDayRow } from './BeforeTheDayRow';

const auth = vi.hoisted(() => ({ organise: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canOrganise: () => auth.organise }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const readiness = {
  competitionId: 3, isReady: false, equipmentFingerprint: 'x',
  missingDeclarations: [{ teamId: 1, teamName: 'Oak A', sectionId: 1, sectionName: 'Open' }, { teamId: 2, teamName: 'Elm B', sectionId: 1, sectionName: 'Open' }],
  unpaidSignups: [], incompleteTeams: [], sessionOverlaps: [], equipmentChecklist: [], equipmentIssues: [],
};
const comp = (statuses: number[]) => ({ id: 3, sessions: statuses.map((status) => ({ status })) }) as unknown as CompetitionDetail;
const view = (c: CompetitionDetail) => render(<MemoryRouter><BeforeTheDayRow competition={c} /></MemoryRouter>);

describe('BeforeTheDayRow', () => {
  beforeEach(() => { auth.organise = true; vi.mocked(api.get).mockReset(); vi.mocked(api.get).mockResolvedValue({ data: readiness }); });

  it('links to the hub with the to-sort count before the first session starts', async () => {
    view(comp([0, 0]));
    expect(await screen.findByText('2 things to sort')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Before the day/ })).toHaveAttribute('href', '/competitions/3/operations');
  });

  it('shows the row without a count when nothing is left or the check fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    view(comp([]));
    expect(await screen.findByRole('link', { name: 'Before the day' })).toBeInTheDocument();
    expect(screen.queryByText(/to sort/)).toBeNull();
  });

  it('says "1 thing" for a single job', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...readiness, missingDeclarations: readiness.missingDeclarations.slice(0, 1) } });
    view(comp([0]));
    expect(await screen.findByText('1 thing to sort')).toBeInTheDocument();
  });

  it('is gone once a session has started, and for non-organisers, without asking the API', () => {
    const { unmount } = view(comp([0, 1]));
    expect(screen.queryByRole('link')).toBeNull();
    unmount();
    auth.organise = false;
    view(comp([0]));
    expect(screen.queryByRole('link')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('counts a competition with no sessions as not started', () => {
    expect(eventHasStarted({} as CompetitionDetail)).toBe(false);
    expect(eventHasStarted(comp([2]))).toBe(true);
  });
});
