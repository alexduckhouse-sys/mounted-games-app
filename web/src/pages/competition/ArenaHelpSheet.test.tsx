import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoConfirm } from '../../test/confirm';

const post = vi.fn();
vi.mock('../../api', () => ({ api: { post: (...a: unknown[]) => post(...a) } }));

import { ArenaHelpSheet } from './ArenaHelpSheet';

describe('ArenaHelpSheet', () => {
  beforeEach(() => { post.mockReset(); });

  it('confirms, then sends the call and shows a sent state', async () => {
    post.mockResolvedValue({ data: { id: 1, body: 'Vet needed at Arena 1' } });
    const asked = autoConfirm(true);
    render(<ArenaHelpSheet competitionId={5} sessionId={7} arenaName="Arena 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Call vet' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/competitions/5/sessions/7/assistance', expect.objectContaining({ service: 'vet', holdArena: true, arenaName: 'Arena 1' })));
    expect(asked.mock.calls[0][0]).toContain('pauses the arena');
    expect(await screen.findByText('Notice sent to the event.')).toBeInTheDocument();
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    autoConfirm(false);
    render(<ArenaHelpSheet competitionId={5} sessionId={7} arenaName="Arena 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Call farrier' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
  });

  it('can skip pausing and reports a failure', async () => {
    post.mockRejectedValue(new Error('offline'));
    autoConfirm(true);
    render(<ArenaHelpSheet competitionId={5} sessionId={7} arenaName="Arena 1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Call first aid' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ holdArena: false })));
    expect(await screen.findByText(/Could not send the arena call/)).toBeInTheDocument();
  });
});
