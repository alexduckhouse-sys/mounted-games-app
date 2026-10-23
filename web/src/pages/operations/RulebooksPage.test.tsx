import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { RulebooksPage } from './RulebooksPage';

const auth = vi.hoisted(() => ({ editorMode: true, admin: true }));

vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition: { id: 7, name: 'Sample Games', createdByUserId: 'owner' } }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ editorMode: auth.editorMode, canEdit: () => auth.editorMode, canOrganise: () => true, hasRole: () => auth.admin }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const handbook = { id: 2, title: 'Event handbook', edition: '2030', sourceUrl: null, updatedAt: '2030-01-01T00:00:00Z' };
const junior = { id: 3, title: 'Junior rules', edition: '2031', sourceUrl: null, updatedAt: '2030-02-01T00:00:00Z' };
const texts: Record<string, unknown> = {
  '/rulebooks/2': { ...handbook, sourceUrl: 'https://example.test/rules', text: 'Keep the changeover clear.' },
  '/rulebooks/3': { ...junior, text: 'Helmets stay on.' },
};

function serve(list: unknown[]) {
  vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/rulebooks' ? list : texts[url] }));
}

const mount = () => render(<MemoryRouter><RulebooksPage /></MemoryRouter>);

describe('RulebooksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.editorMode = true;
    auth.admin = true;
    serve([handbook]);
  });

  it('lists the shared rulebooks without loading any text', async () => {
    mount();
    expect(await screen.findByRole('button', { name: /^Event handbook/ })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/rulebooks');
    expect(screen.queryByText('Keep the changeover clear.')).not.toBeInTheDocument();
  });

  it('loads a rulebook only when it is chosen, and reuses it afterwards', async () => {
    serve([handbook, junior]);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^Event handbook/ }));
    expect(await screen.findByText('Keep the changeover clear.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Source/ })).toHaveAttribute('href', 'https://example.test/rules');
    expect(within(screen.getByRole('button', { name: /^Event handbook/ })).getByText('Showing')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/rulebooks/2');
    expect(api.get).not.toHaveBeenCalledWith('/rulebooks/3');

    await user.click(screen.getByRole('button', { name: /^Junior rules/ }));
    expect(await screen.findByText('Helmets stay on.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Source/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Event handbook/ }));
    expect(screen.getByText('Keep the changeover clear.')).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/rulebooks/2')).toHaveLength(1);
  });

  it('says so when the rulebook cannot be loaded, and retries', async () => {
    const user = userEvent.setup();
    mount();
    const row = await screen.findByRole('button', { name: /^Event handbook/ });
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    await user.click(row);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load this rulebook');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Keep the changeover clear.')).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded, and reloads it', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the rulebooks');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^Event handbook/ })).toBeInTheDocument();
  });

  it('shows a note when no rulebooks exist', async () => {
    serve([]);
    mount();
    expect(await screen.findByText('No rulebooks have been published yet.')).toBeInTheDocument();
  });

  it('opens an admin editor with plain-text fields', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add rulebook' }));
    expect(screen.getByRole('heading', { name: 'New rulebook' })).toBeInTheDocument();
    expect(screen.getByLabelText('Rulebook text')).toBeInTheDocument();
  });

  it('closes the editor when an admin returns to view mode', async () => {
    const user = userEvent.setup();
    const page = mount();
    await user.click(await screen.findByRole('button', { name: 'Add rulebook' }));
    expect(screen.getByLabelText('Rulebook text')).toBeInTheDocument();
    auth.editorMode = false;
    page.rerender(<MemoryRouter><RulebooksPage /></MemoryRouter>);
    expect(screen.queryByLabelText('Rulebook text')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Event handbook/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rulebook' })).not.toBeInTheDocument();
  });

  it('saves a new rulebook from the editor', async () => {
    const created = { id: 9, title: 'New', edition: '1', sourceUrl: null, text: 'Body', updatedAt: '2030-03-01T00:00:00Z' };
    vi.mocked(api.post).mockImplementation(async () => { serve([handbook, created]); return { data: created }; });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add rulebook' }));
    await user.type(screen.getByLabelText('Title'), 'New');
    await user.type(screen.getByLabelText('Edition'), '1');
    await user.type(screen.getByLabelText('Rulebook text'), 'Body');
    await user.click(screen.getByRole('button', { name: 'Save rulebook' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rulebooks', { title: 'New', edition: '1', sourceUrl: null, text: 'Body' }));
    expect(await screen.findByText('Rulebook saved.')).toBeInTheDocument();
    expect(await screen.findByText('Body')).toBeInTheDocument();
  });

  it('edits and deletes the open rulebook', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { ...texts['/rulebooks/2'] as object, title: 'Handbook v2', text: 'Changed.' } });
    vi.mocked(api.delete).mockResolvedValue({ data: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^Event handbook/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit Event handbook' }));
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Handbook v2');
    await user.click(screen.getByRole('button', { name: 'Save rulebook' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/rulebooks/2', expect.objectContaining({ title: 'Handbook v2' })));
    expect(await screen.findByText('Changed.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Handbook v2' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/rulebooks/2'));
    expect(screen.queryByText('Changed.')).not.toBeInTheDocument();
  });

  it('shows a save error from the server', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { message: 'That rulebook title and edition already exists.' } }, isAxiosError: true });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add rulebook' }));
    await user.type(screen.getByLabelText('Title'), 'Event handbook');
    await user.type(screen.getByLabelText('Edition'), '2030');
    await user.type(screen.getByLabelText('Rulebook text'), 'Body');
    await user.click(screen.getByRole('button', { name: 'Save rulebook' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('hides the edit controls from organisers who are not admins', async () => {
    auth.admin = false;
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /^Event handbook/ }));
    expect(await screen.findByText('Keep the changeover clear.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rulebook' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Event handbook' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Event handbook' })).not.toBeInTheDocument();
  });
});
