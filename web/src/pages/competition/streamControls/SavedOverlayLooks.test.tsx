import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { SavedOverlayLooks } from './SavedOverlayLooks';
vi.mock('../../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: [{ id: 1, name: 'Demo look', look: { accent: '#123456', liveSectionId: 999 }, mine: true }] }); });
describe('saved overlay looks', () => {
  it('previews the visual look and applies it only after a separate tap', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    render(<SavedOverlayLooks look={{}} apply={apply} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /Choose a look/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Demo look' }));
    expect(screen.getByLabelText('Saved look preview')).toHaveTextContent('Demo look');
    expect(apply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Apply look' }));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ accent: '#123456' }));
    expect(apply.mock.calls[0][0]).not.toHaveProperty('liveSectionId');
  });
  it('keeps only visual settings in a new preset', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 2, name: 'Demo new', look: {}, mine: true } });
    render(<SavedOverlayLooks look={{ liveCard: 'result', liveSectionId: 22, accent: '#abcdef' }} apply={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Keep current look' }));
    await userEvent.type(screen.getByLabelText('Look name'), 'Demo new');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ name: 'Demo new', look: { accent: '#abcdef' } });
    expect((vi.mocked(api.post).mock.calls[0][1] as { look: unknown }).look).not.toHaveProperty('liveCard');
  });
});
