import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { SaveStartingPoint } from './SaveStartingPoint';
vi.mock('../../api', () => ({ api: { post: vi.fn() } }));
describe('keeping a template', () => {
  it('uses the setup-only endpoint after naming and keeps failed drafts', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: {} });
    render(<SaveStartingPoint competitionId={7} competitionName="Demo event" />);
    await userEvent.click(screen.getByRole('button', { name: 'Keep as a template' }));
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t keep this template');
    expect(screen.getByLabelText('Template name')).toHaveValue('Demo event');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/competitions/7/starting-points', { name: 'Demo event' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Template added');
  });
});
