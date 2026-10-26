import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { RaceTemplate } from '../../types';
import { RulesPage } from './RulesPage';

import { autoConfirm } from '../../test/confirm';
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ edit: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ canEdit: () => auth.edit }) }));

const races: RaceTemplate[] = [
  { id: 1, name: 'Speed Weave', category: 'Bending', summary: 'Weave the poles.', rules: 'Weave out and back.', diagramJson: '[]', isBuiltIn: true },
  { id: 2, name: 'Flag Race', category: 'Equipment', summary: 'Move flags.', rules: 'Swap the flags.', diagramJson: '[]', isBuiltIn: false },
  { id: 3, name: 'Mystery', category: null, summary: null, rules: null, diagramJson: null, isBuiltIn: false },
];

function mount() {
  return render(<MemoryRouter><RulesPage /></MemoryRouter>);
}

beforeEach(() => {
  auth.edit = true;
  autoConfirm(true);
  vi.mocked(api.get).mockResolvedValue({ data: races });
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  vi.mocked(api.delete).mockResolvedValue({ data: {} });
});

describe('RulesPage', () => {
  it('lists the races and filters by search and category', async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText('Speed Weave')).toBeInTheDocument();
    expect(screen.getByText('3 races in the library')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search races' }), 'flags');
    expect(screen.queryByText('Speed Weave')).not.toBeInTheDocument();
    expect(screen.getByText('Flag Race')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search races' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search races' }), 'nothing at all');
    expect(screen.getByText('No races match that search.')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search races' }));
    await user.click(screen.getByRole('combobox', { name: 'Category' }));
    await user.click(await screen.findByRole('option', { name: 'Equipment' }));
    expect(screen.queryByText('Speed Weave')).not.toBeInTheDocument();
    expect(screen.getByText('Flag Race')).toBeInTheDocument();
  });

  it('shows an empty library message', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    mount();
    expect(await screen.findByText('No races yet.')).toBeInTheDocument();
  });

  it('keeps the library read-only for someone who is not an admin', async () => {
    auth.edit = false;
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /Speed Weave/ }));
    expect(screen.getByText('Weave out and back.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New race/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/edit mode/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Mystery/ }));
    expect(screen.getByText('No rules written yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Mystery/ }));
    expect(screen.queryByText('No rules written yet.')).not.toBeInTheDocument();
  });

  it('edits a race in place and saves it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /Flag Race/ }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Flag Relay');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/race-templates/2', expect.objectContaining({ name: 'Flag Relay', category: 'Equipment', summary: 'Move flags.', rules: 'Swap the flags.' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
  });

  it('only offers Delete on races that are not built in', async () => {
    const user = userEvent.setup();
    const confirm = autoConfirm(true);
    mount();
    await user.click(await screen.findByRole('button', { name: /Speed Weave/ }));
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Flag Race/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('“Flag Race” goes from the library for good.'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/race-templates/2'));
  });

  it('does not delete when the organiser says no, and reports a failed delete', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /Flag Race/ }));
    autoConfirm([false]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.delete).not.toHaveBeenCalled();
    vi.mocked(api.delete).mockRejectedValueOnce({ response: { data: { message: 'In use.' } } });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('In use.');
  });

  it('creates a new race and shows a save error', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /New race/ }));
    await user.type(screen.getByLabelText('Name'), 'Bucket Race');
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: 'Name taken.' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name taken.');
    vi.mocked(api.post).mockRejectedValueOnce({});
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save.'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/race-templates', expect.objectContaining({ name: 'Bucket Race', category: null, summary: null, rules: null })));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
  });

  it('cancels an edit and toggles the diagram editor and JSON', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /Flag Race/ }));
    await user.click(screen.getByRole('button', { name: 'Edit diagram' }));
    await user.click(screen.getByRole('button', { name: 'Show JSON' }));
    expect(screen.getByLabelText('Diagram JSON')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide JSON' }));
    await user.click(screen.getByRole('button', { name: 'Hide diagram editor' }));
    const form = screen.getByRole('button', { name: 'Cancel' }).closest('form')!;
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('switches to the Rulebooks tab to view and manage rulebooks in the same place', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => ({
      data: url === '/rulebooks'
        ? [{ id: 2, title: 'Event handbook', edition: '2030', sourceUrl: null, updatedAt: '2030-01-01T00:00:00Z' }]
        : races,
    }));
    const user = userEvent.setup();
    mount();
    await screen.findByText('Speed Weave');
    await user.click(screen.getByRole('tab', { name: 'Rulebooks' }));
    expect(await screen.findByRole('button', { name: /^Event handbook/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add rulebook' })).toBeInTheDocument();
  });
});
