import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { SavedStartingPoints } from './SavedStartingPoints';
vi.mock('../../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../refine/Refine', () => ({ RefineDateTimeRow: ({ label, value, onChange }: { label: string; value: string | null; onChange: (s: string) => void }) => <label>{label}<input value={value ?? ''} onChange={e => onChange(e.target.value)} /></label> }));
beforeEach(() => { vi.mocked(api.get).mockResolvedValue({ data: [{ id: 7, name: 'Demo template', sections: 2, sessions: 4, isMine: true }] }); vi.mocked(api.post).mockResolvedValue({ data: { competitionId: 42 } }); });
function setup() { render(<MemoryRouter><Routes><Route path="/" element={<SavedStartingPoints />} /><Route path="/admin/competitions/:id" element={<p>Editing created competition</p>} /></Routes></MemoryRouter>); }
describe('saved competition templates', () => {
  it('waits for an explicit creation action with a name and dates, then opens the new competition', async () => {
    setup(); await userEvent.click(await screen.findByRole('button', { name: /Demo template/ }));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create competition' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Starts'), '2027-04-01T08:00:00.000Z');
    await userEvent.type(screen.getByLabelText('Ends (optional)'), '2027-04-02T17:00:00.000Z');
    await userEvent.click(screen.getByRole('button', { name: 'Create competition' }));
    expect(await screen.findByText('Editing created competition')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/starting-points/7/competition', { name: 'Demo template', startDate: '2027-04-01T08:00:00.000Z', endDate: '2027-04-02T17:00:00.000Z' });
  });
  it('keeps the form and dates available when creation fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('offline'));
    setup(); await userEvent.click(await screen.findByRole('button', { name: /Demo template/ }));
    await userEvent.type(screen.getByLabelText('Starts'), '2027-04-01T08:00:00.000Z');
    await userEvent.click(screen.getByRole('button', { name: 'Create competition' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t use the template');
    expect(screen.getByLabelText('Starts')).toHaveValue('2027-04-01T08:00:00.000Z');
  });
  it('renames without creating an event', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: {} }); setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    await userEvent.clear(screen.getByLabelText('Template name'));
    await userEvent.type(screen.getByLabelText('Template name'), 'Demo summer');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/starting-points/7', { name: 'Demo summer' }));
    expect(api.post).not.toHaveBeenCalled();
  });
});
