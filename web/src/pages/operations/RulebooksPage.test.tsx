import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { RulebooksPage } from './RulebooksPage';

const auth = vi.hoisted(() => ({ editorMode: true }));

vi.mock('../competition/context', () => ({ useCompetition: () => ({ competition: { id: 7, name: 'Sample Games', createdByUserId: 'owner' } }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ editorMode: auth.editorMode, canEdit: () => auth.editorMode, canOrganise: () => true, hasRole: () => true }) }));
vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

describe('RulebooksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.editorMode = true;
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 2, competitionId: 7, title: 'Event handbook', edition: '2030', sourceUrl: null, text: 'Keep the changeover clear.', updatedAt: '2030-01-01T00:00:00Z' }] });
  });

  it('shows the selected public rulebook', async () => {
    render(<MemoryRouter><RulebooksPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Event handbook' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText('Keep the changeover clear.')).toBeInTheDocument();
  });

  it('opens an organiser editor with plain-text fields', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><RulebooksPage /></MemoryRouter>);
    await screen.findByText('Keep the changeover clear.', {}, { timeout: 10_000 });
    await user.click(screen.getByRole('button', { name: 'Add rulebook' }));
    expect(screen.getByRole('heading', { name: 'New rulebook' })).toBeInTheDocument();
    expect(screen.getByLabelText('Rulebook text')).toBeInTheDocument();
  });
  it('closes the editor when an admin returns to view mode', async () => {
    const user = userEvent.setup();
    const page = render(<MemoryRouter><RulebooksPage /></MemoryRouter>);
    await screen.findByText('Keep the changeover clear.');
    await user.click(screen.getByRole('button', { name: 'Add rulebook' }));
    expect(screen.getByLabelText('Rulebook text')).toBeInTheDocument();
    auth.editorMode = false;
    page.rerender(<MemoryRouter><RulebooksPage /></MemoryRouter>);
    expect(screen.queryByLabelText('Rulebook text')).not.toBeInTheDocument();
    expect(await screen.findByText('Keep the changeover clear.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rulebook' })).not.toBeInTheDocument();
  });

  it('lists several rulebooks as rows and switches the one being read', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { id: 2, competitionId: 7, title: 'Event handbook', edition: '2030', sourceUrl: 'https://example.test/rules', text: 'Keep the changeover clear.', updatedAt: '2030-01-01T00:00:00Z' },
      { id: 3, competitionId: 7, title: 'Junior rules', edition: '2031', sourceUrl: null, text: 'Helmets stay on.', updatedAt: '2030-02-01T00:00:00Z' },
    ] });
    const user = userEvent.setup();
    render(<MemoryRouter><RulebooksPage /></MemoryRouter>);
    expect(await screen.findByText('Keep the changeover clear.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Source/ })).toHaveAttribute('href', 'https://example.test/rules');
    const current = screen.getByRole('button', { name: /^Event handbook/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(within(current).getByText('Showing')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Junior rules/ }));
    expect(screen.getByText('Helmets stay on.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Source/ })).not.toBeInTheDocument();
  });

  it('saves a new rulebook from the editor', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 9, competitionId: 7, title: 'New', edition: '1', sourceUrl: null, text: 'Body', updatedAt: '2030-03-01T00:00:00Z' } });
    const user = userEvent.setup();
    render(<MemoryRouter><RulebooksPage /></MemoryRouter>);
    await screen.findByText('Keep the changeover clear.');
    await user.click(screen.getByRole('button', { name: 'Add rulebook' }));
    await user.type(screen.getByLabelText('Title'), 'New');
    await user.type(screen.getByLabelText('Edition'), '1');
    await user.type(screen.getByLabelText('Rulebook text'), 'Body');
    await user.click(screen.getByRole('button', { name: 'Save rulebook' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/competitions/7/rulebooks', { title: 'New', edition: '1', sourceUrl: null, text: 'Body' }));
    expect(await screen.findByText('Rulebook saved.')).toBeInTheDocument();
  });

  it('keeps Edit and Delete for organisers who can write', async () => {
    render(<MemoryRouter><RulebooksPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Edit Event handbook' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Event handbook' })).toBeInTheDocument();
  });
});
