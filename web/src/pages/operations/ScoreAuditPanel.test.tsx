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
});
