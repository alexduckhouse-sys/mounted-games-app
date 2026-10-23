import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { DEFAULT_LOOK } from '../../lib/overlays';
import { SavedLooks } from './SavedLooks';
import { chooseOption, optionLabels, selectedValue } from '../../test/select';
import { autoConfirm } from '../../test/confirm';

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const champs = { id: 1, name: 'EGUK Champs', look: { accent: '#1e3466' }, mine: true };
const shared = { id: 2, name: 'Club look', look: {}, mine: false };

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: [champs, shared, { id: 'bad' }] });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 3, name: 'Pony Club Spring', look: { size: 'large' }, mine: true } });
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  vi.mocked(api.delete).mockResolvedValue({ data: {} });
});

async function show(onApply = vi.fn(), onError = vi.fn()) {
  render(<SavedLooks current={{ ...DEFAULT_LOOK, accent: '#ff0000' }} onApply={onApply} onError={onError} />);
  await act(async () => {});
  return { onApply, onError };
}

const box = () => screen.getByLabelText('Saved looks');
const choose = (id: string) => chooseOption(box(), id);

describe('SavedLooks', () => {
  it('lists saved looks, marking ones shared by someone else', async () => {
    await show();
    const labels = optionLabels(box());
    expect(labels).toContain('EGUK Champs');
    expect(labels).toContain('Club look (shared)');
    expect(labels).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Use for this event' })).toBeDisabled();
  });

  it('copies a chosen look into this event', async () => {
    const { onApply } = await show();
    choose('1');
    fireEvent.click(screen.getByRole('button', { name: 'Use for this event' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ accent: '#1e3466' }));
  });

  it('saves the current look under a new name and selects it', async () => {
    await show();
    fireEvent.change(screen.getByLabelText('New look name'), { target: { value: '  Pony Club Spring ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as look' })); });
    expect(api.post).toHaveBeenCalledWith('/overlay-looks', { name: 'Pony Club Spring', look: expect.objectContaining({ accent: '#ff0000' }) });
    expect(selectedValue(box())).toBe('3');
    expect(screen.getByLabelText('New look name')).toHaveValue('');
  });

  it('updates and deletes your own look, but can only update a shared one', async () => {
    await show();
    choose('2');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    choose('1');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update saved look' })); });
    expect(api.put).toHaveBeenCalledWith('/overlay-looks/1', { name: 'EGUK Champs', look: expect.objectContaining({ accent: '#ff0000' }) });
    const asked = autoConfirm([false, true]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
    await waitFor(() => expect(asked).toHaveBeenCalledWith('Delete the look “EGUK Champs”?'));
    expect(api.delete).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/overlay-looks/1'));
    expect(optionLabels(box())).not.toContain('EGUK Champs');
  });

  it('copes with no looks, a failed load and a failed save', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: 'not a list' });
    vi.mocked(api.post).mockRejectedValue(new Error('no signal'));
    const { onError } = await show();
    expect(box()).toHaveTextContent('None saved yet');
    fireEvent.change(screen.getByLabelText('New look name'), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as look' })); });
    expect(onError).toHaveBeenCalledWith('Couldn’t save the look. Check your connection and try again.');

    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    render(<SavedLooks current={DEFAULT_LOOK} onApply={vi.fn()} onError={vi.fn()} />);
    await act(async () => {});
  });

  it('ignores a malformed answer when saving', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: 'garbled' });
    await show();
    fireEvent.change(screen.getByLabelText('New look name'), { target: { value: 'x' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as look' })); });
    expect(optionLabels(box())).toHaveLength(3);
  });
});
