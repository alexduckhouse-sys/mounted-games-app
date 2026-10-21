import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { ScoreAuditPanel } from './ScoreAuditPanel';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canEdit: () => true }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));

const score = { raceId: 9, revision: 1, isSignedOff: false, signedOffAt: null, signedOffByUserId: null, idempotentReplay: false, results: [{ teamId: 4, place: 1, eliminated: false, points: 4 }] };

describe('ScoreAuditPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/history') ? [] : score }));
    vi.mocked(api.put).mockResolvedValue({ data: score });
    vi.mocked(api.post).mockResolvedValue({ data: { ...score, revision: 2, isSignedOff: true } });
  });

  it('requires a reason before saving a correction', async () => {
    const user = userEvent.setup();
    render(<ScoreAuditPanel raceId={9} />);
    await screen.findByText('Open for scoring');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(screen.getByRole('textbox', { name: 'Correction reason' })).toBeInvalid();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('removes the previous race actions while the next record loads', async () => {
    const { rerender } = render(<ScoreAuditPanel raceId={9} />);
    await screen.findByRole('button', { name: 'Sign off results' });
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    rerender(<ScoreAuditPanel raceId={10} />);
    expect(screen.queryByRole('button', { name: 'Sign off results' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading score history');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('signs off the current revision', async () => {
    const user = userEvent.setup();
    render(<ScoreAuditPanel raceId={9} />);
    await user.click(await screen.findByRole('button', { name: 'Sign off results' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/races/9/score/sign-off', expect.objectContaining({ expectedRevision: 1 })));
  });
  it('keeps corrections behind a collapsed row and saves with a reason', async () => {
    const user = userEvent.setup();
    render(<ScoreAuditPanel raceId={9} />);
    await screen.findByText('Open for scoring');
    expect(screen.getByText('Correct placings').closest('details')).not.toHaveAttribute('open');

    await user.type(screen.getByRole('textbox', { name: 'Correction reason' }), 'Judge recount');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/races/9/score', expect.objectContaining({
      places: [{ teamId: 4, place: 1, eliminated: false }], expectedRevision: 1, reason: 'Judge recount',
    })));
    expect(await screen.findByText('Correction saved.')).toBeInTheDocument();
  });

  it('lists history as rows and asks for a reason before reopening', async () => {
    const signedOff = { ...score, isSignedOff: true, signedOffAt: '2030-01-01T10:00:00Z', signedOffByUserId: 'u1' };
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/history')
      ? [{ revision: 2, kind: 3, before: score.results, after: score.results, actorUserId: 'u1', reason: 'All checked', createdAt: '2030-01-01T10:00:00Z' }]
      : signedOff }));
    const user = userEvent.setup();
    render(<ScoreAuditPanel raceId={9} />);

    expect(await screen.findAllByText('Signed off')).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Score history' })).toHaveTextContent('All checked');
    expect(screen.queryByText('Correct placings')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen results' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a reason for reopening these results.');
    expect(api.post).not.toHaveBeenCalled();
  });
});
