import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { ScoreAuditPanel } from './ScoreAuditPanel';

const auth = vi.hoisted(() => ({ manage: true, asked: [] as unknown[] }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ canManage: (competition: unknown) => { auth.asked.push(competition); return auth.manage; } }),
}));
vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition: { id: 5, createdByUserId: 'owner-1' } }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const score = { raceId: 9, revision: 1, isSignedOff: false, signedOffAt: null, signedOffByUserId: null, idempotentReplay: false, results: [{ teamId: 4, place: 1, eliminated: false, points: 4 }] };

describe('ScoreAuditPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.manage = true;
    auth.asked = [];
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/history') ? [] : score }));
    vi.mocked(api.put).mockResolvedValue({ data: score });
  });

  it('shows the record but no sign-off or corrections to someone who cannot manage this competition', async () => {
    auth.manage = false;
    render(<ScoreAuditPanel raceId={9} />);
    await screen.findByRole('button', { name: 'Refresh score history' });
    expect(screen.queryByRole('button', { name: 'Sign off results' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save correction' })).not.toBeInTheDocument();
    expect(auth.asked).toContainEqual({ id: 5, createdByUserId: 'owner-1' });
  });

  it('requires a reason before saving a correction', async () => {
    const user = userEvent.setup();
    render(<ScoreAuditPanel raceId={9} />);
    await screen.findByRole('button', { name: 'Save correction' });
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(screen.getByRole('textbox', { name: 'Correction reason' })).toBeInvalid();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('removes the previous race actions while the next record loads', async () => {
    const { rerender } = render(<ScoreAuditPanel raceId={9} />);
    await screen.findByRole('button', { name: 'Save correction' });
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    rerender(<ScoreAuditPanel raceId={10} />);
    expect(screen.queryByRole('button', { name: 'Save correction' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading score history');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps corrections behind a collapsed row and saves with a reason', async () => {
    const user = userEvent.setup();
    render(<ScoreAuditPanel raceId={9} />);
    await screen.findByRole('button', { name: 'Save correction' });
    expect(screen.getByText('Correct placings').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByRole('button', { name: 'Sign off results' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen results' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Correction reason' }), 'Judge recount');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/races/9/score', expect.objectContaining({
      places: [{ teamId: 4, place: 1, eliminated: false }], expectedRevision: 1, reason: 'Judge recount',
    })));
    expect(await screen.findByText('Correction saved')).toBeInTheDocument();
  });

  it('names each team, and says so when a team has no name instead of showing its number', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ScoreAuditPanel raceId={9} />);
    await screen.findByRole('button', { name: 'Save correction' });
    await user.click(screen.getByText('Correct placings'));
    expect(screen.getByLabelText('Points for Unnamed team')).toBeInTheDocument();
    expect(screen.queryByText(/Team 4/)).not.toBeInTheDocument();
    unmount();
    render(<ScoreAuditPanel raceId={9} teams={[{ teamId: 4, teamName: 'Rockwood A' }]} />);
    await screen.findByRole('button', { name: 'Save correction' });
    await user.click(screen.getByText('Correct placings'));
    expect(screen.getByText('Rockwood A')).toBeInTheDocument();
  });

  it('preserves and edits half-point manual overrides when saving a correction', async () => {
    const user = userEvent.setup();
    render(<ScoreAuditPanel raceId={9} teams={[{ teamId: 4, teamName: 'Rockwood A' }]} />);
    await screen.findByRole('button', { name: 'Save correction' });
    await user.click(screen.getByText('Correct placings'));

    const pointsInput = screen.getByLabelText('Points for Rockwood A');
    await user.clear(pointsInput);
    await user.type(pointsInput, '2.5');
    await user.type(screen.getByRole('textbox', { name: 'Correction reason' }), 'Split dead heat');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/races/9/score', expect.objectContaining({
      places: [{ teamId: 4, place: 1, eliminated: false, points: 2.5 }],
      expectedRevision: 1,
      reason: 'Split dead heat',
    })));
  });

  it('lists score history as rows with no sign-off or reopen controls', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/history')
      ? [{ revision: 2, kind: 2, before: score.results, after: score.results, actorUserId: 'u1', reason: 'Referee protest upheld', createdAt: '2030-01-01T10:00:00Z' }]
      : score }));
    render(<ScoreAuditPanel raceId={9} />);

    expect(await screen.findByRole('list', { name: 'Score history' })).toHaveTextContent('Referee protest upheld');
    expect(screen.getByRole('list', { name: 'Score history' })).toHaveTextContent('Results corrected');
    expect(screen.queryByRole('button', { name: 'Sign off results' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen results' })).not.toBeInTheDocument();
  });
});
