import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { autoConfirm } from '../../test/confirm';
import { DrawUndoBanner } from './DrawUndoBanner';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const status = (over: Record<string, unknown> = {}) => ({
  available: true, undoId: 1, kind: 'SectionDraw', label: 'Under 12 draw', sectionId: 11, sessionId: null,
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 28 * 60_000).toISOString(), affectedHeats: 3, affectedSessions: 1, ...over,
});

describe('DrawUndoBanner', () => {
  beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: status() }); });

  it('says what can be put back and for how long', async () => {
    render(<DrawUndoBanner competitionId={7} />);
    expect(await screen.findByText(/Under 12 draw \(3 heats · 2\dm left\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo the draw' })).toBeInTheDocument();
  });

  it('shows nothing when there is nothing to undo or the window has closed', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { available: false } });
    const { container } = render(<DrawUndoBanner competitionId={7} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to restore deleted heats with its own wording', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: status({ kind: 'DeleteHeat' }) });
    render(<DrawUndoBanner competitionId={7} />);
    expect(await screen.findByRole('button', { name: 'Restore the heats' })).toBeInTheDocument();
  });

  it('asks first, then puts the draw back and tells the page', async () => {
    const asked = autoConfirm(true);
    const restored = vi.fn();
    vi.mocked(api.post).mockResolvedValue({ data: { restored: true, label: 'Under 12 draw', restoredSessions: 1, restoredHeats: 3, undoStatus: { available: false } } });
    render(<DrawUndoBanner competitionId={7} onRestored={restored} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo the draw' }));
    await waitFor(() => expect(restored).toHaveBeenCalled());
    expect(asked.titles).toEqual(['Undo the draw?']);
    expect(api.post).toHaveBeenCalledWith('/competitions/7/draw-undo', {});
    expect(await screen.findByText('Draw put back')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo the draw' })).not.toBeInTheDocument();
  });

  it('does nothing when the organiser says no', async () => {
    autoConfirm(false);
    render(<DrawUndoBanner competitionId={7} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo the draw' }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the reason when scores stop it', async () => {
    autoConfirm(true);
    vi.mocked(api.post).mockRejectedValue({ response: { status: 409, data: { message: 'Cannot undo because races have already been scored in the affected heats.' } } });
    render(<DrawUndoBanner competitionId={7} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo the draw' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been scored');
  });

  it('falls back to a plain message and looks again when the version changes', async () => {
    autoConfirm(true);
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    const { rerender } = render(<DrawUndoBanner competitionId={7} version={0} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Undo the draw' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t put the draw back');
    const calls = vi.mocked(api.get).mock.calls.length;
    rerender(<DrawUndoBanner competitionId={7} version={1} />);
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(calls));
  });
});
